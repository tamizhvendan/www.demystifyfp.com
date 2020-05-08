---
title: "Generic Programming Made Easy"
date: 2017-12-15T19:39:26+05:30
tags: ["fsharp", "reflection", "TypeShape", "generics"]
---

Generic programming is a style of computer programming in which algorithms are written in terms of types to-be-specified-later that are then instantiated when needed for specific types provided as parameters[^1]. 

Generic programming was part of .NET since .NET Version 2.0 and has [a fascinating history](https://blogs.msdn.microsoft.com/dsyme/2011/03/15/netc-generics-history-some-photos-from-feb-1999/) as well!

For most of the use cases which involves generics, implementing them in F# is a cake-walk. However, when the generic programming requires reflection, it becomes a bumpy ride. Let's have a look at the source code[^2] below to get a feel of what I mean here! 

```fsharp
let rec print (value : obj) =
  match value with
  | null -> "<null>"
  | :? int as i -> string i
  | :? string as s -> s
  | _ ->
    let t = value.GetType()
    let isGenTypeOf (gt : Type) =
        t.IsGenericType && gt = t.GetGenericTypeDefinition()
    if isGenTypeOf typedefof<_ option> then
        let value = t.GetProperty("Value").GetValue(value)
        sprintf "Some %s" (print value)
    elif isGenTypeOf typedefof<_ * _> then
        let v1 = t.GetProperty("Item1").GetValue(value)
        let v2 = t.GetProperty("Item2").GetValue(value)
        sprintf "(%s, %s)" (print v1) (print v2)
    else
        value.ToString()
```

This code snippet returns the string representation of the parameter `value`. The if-else-if expression unwraps the value from the `Option` type and `Tuple` type and return its underlying values by recursively calling the `print` function respectively.

```bash
> print (Some "John");;
val it : string = "Some John"

> print (1,(Some "data"));;
val it : string = "(1, Some data)"
```
The hardcoded strings, lack of type safety are some of the concerns in the above snippet. 

```fsharp
let rec print (value : obj) =
  // ...
    if isGenTypeOf typedefof<_ option> then
      let value = t.GetProperty("Value").GetValue(value)
        // ...
    elif isGenTypeOf typedefof<_ * _> then
      let v1 = t.GetProperty("Item1").GetValue(value)
      let v2 = t.GetProperty("Item2").GetValue(value)
      // ...
  // ...
```

Like this piece of code, we may need to write some more ugly and hard to maintain code, if we do some advanced reflection. F# is not known for this kind of problems. There should be a better way!

Yes, That's where [TypeShape](https://github.com/eiriktsarpalis/TypeShape) comes into the picture. 

> TypeShape is a small, extensible F# library for practical generic programming. It uses a combination of reflection, active patterns, visitor pattern and F# object expressions to minimize the amount of reflection that we need to write - Eirik Tsarpalis

In this blog post, we are going to learn the basics of the TypeShape library by implementing an use case from scratch. In this process, We are also going to learn how to build a reusable library in F# in an incremental fashion. 

> This blog post is a part of the [F# Advent Calendar 2017](https://sergeytihon.com/2017/10/22/f-advent-calendar-in-english-2017/). 

## The Use Cases

Reading a value from an environment variable and converting the read value to a different target type (from `string` type) to consume it is a boilerplate code. 

```fsharp
open System

// unit -> Result<int, string>
let getPortFromEnvVar () =
  let value =
    Environment.GetEnvironmentVariable "PORT"
  match Int32.TryParse value with
  | true, port -> Ok port
  | _ -> Error "unable to get"
``` 

How about making this logic generic and achieving the same using only one function call?

```fsharp
> parsePrimitive<int> "PORT";;

[<Struct>]
val it : EnvVarParseResult<int> = Ok 5432
```

Sounds good, isn't it?

Often the applications that we develop typically read multiple environment variables. So, How about putting them together in a record type and read all of them in a single shot?

```fsharp
type Config = {
  ConnectionString : string
  Port : int
  EnableDebug : bool
  Environment : string
}

> parseRecord<Config> ();;

[<Struct>]
val it : Result<Config,EnvVarParseError list> =
  Ok {ConnectionString = "Database=foobar;Password=foobaz";
      Port = 5432;
      EnableDebug = true;
      Environment = "staging";}
```

It's even more impressive!!

Let's dive in and implement these two use cases.

## Use Case #1 - Parsing Primitives

### Setting Up

As we will be implementing the use cases by exploring the TypeShape library, F# scripting would be a good fit to get it done. So, let's start with an empty directory and initialise [paket](https://fsprojects.github.io/Paket) using [Forge](https://github.com/fsharp-editing/Forge).

```bash
> mkdir FsEnvConfig
> cd FsEnvConfig
> forge paket init
```

The next step is adding the TypeLibrary and referencing it in the script file.

The entire TypeShape library is available as a single file in GitHub, and we can get it for our development using Paket’s [GitHub File Reference](https://fsprojects.github.io/Paket/github-dependencies.html) feature. To do it, first, we first need to add the reference in the *paket.dependencies* which was auto-generated during the initialisation of paket. 

```
github eiriktsarpalis/TypeShape:2.20 src/TypeShape/TypeShape.fs
```

Then download this dependency by running the paket's `install` command. 

```bash
> forge paket install
```

After successful execution of this command, we can find the *TypeShape.fs* file in the *./paket-files/eiriktsarpalis/TypeShape/src/TypeShape* directory. 

The last step is creating a F# script file *script.fsx* and refer this *TypeShape.fs* file 

```fsharp
// script.fsx
#load "./paket-files/eiriktsarpalis/TypeShape/src/TypeShape/TypeShape.fs"
open TypeShape
```

With this, the stage is now set for the action!

### The Domain Types

The first step is defining the types that we are going to work with

```fsharp
type EnvVarParseError =
| BadValue of (string * string)
| NotFound of string
| NotSupported of string

type EnvVarParseResult<'T> = Result<'T, EnvVarParseError>
```

The `EnvVarParseError` type models the possible errors that we may encounter while parsing environment variables. The cases are

* `BadValue` (name, value) - Environment variable is available but casting to the target type fails  
* `NotFound` name - Environment variable with the given name is not found
* `NotSupported` message - We are not supporting the target datatype


The `EnvVarParseResult<'T>` represents the final output of our parsing. It's either success or failure with any one of the above use cases. We are making use of F# [Result Type](https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/results) to model this representation. 

### Getting Started

Let's get started with the scaffolding of our `parsePrimitive` function.

```fsharp
// string -> EnvVarParseResult<'T>
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =
  NotSupported "unknown target type" |> Error
```

As we are not supporting any type, to begin with, we are just returning the `NotSupported` error. 

The critical thing to notice here is the generic type `<'T>` in the declaration. It is the target type to which we are going to convert the value stored in the provided environment name. 


Alright, Let's take the next step towards recognising the target data type `<'T>`.

> Programs parameterized by shapes of datatypes - *Eirik Tsarpalis*

TypeShape library comes with a set of active patterns to match shapes of the data type. Let's assume that we are going to consider only int, string and bool for simplicity. We can do pattern matching with the shape of these types alone in our existing `parsePrimitive` function and handle these cases as below

 ```fsharp
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =
  match shapeof<'T> with
  | Shape.Int32 -> NotSupported "integer" |> Error
  | Shape.String -> NotSupported "string" |> Error
  | Shape.Bool -> NotSupported "bool" |> Error
  | _ -> NotSupported "unknown target type" |> Error
```

The `shapeof<'T>` returns the `TypeShape` of the provide generic type `'T`.

If we execute this function in F# interactive, we will be getting the following outputs

```bash
> parsePrimitive<int> "TEST";;
[<Struct>]
val it : EnvVarParseResult<int> =
  Error (NotSupported "integer")

> parsePrimitive<string> "TEST";;
[<Struct>]
val it : EnvVarParseResult<string> =
  Error (NotSupported "string")

> parsePrimitive<bool> "TEST";;
[<Struct>]
val it : EnvVarParseResult<bool> =
  Error (NotSupported "bool")

> parsePrimitive<double> "TEST";;
[<Struct>]
val it : EnvVarParseResult<double> =
  Error (NotSupported "unknown target type")
```

### Parsing Environment Variable

The extended `parsePrimitive` function now able to recognise the shape of the data type. The next step adding logic to parse the environment variable

The `Environment.GetEnvironmentVariable` from .NET library returns `null` if the environment variable with the given name not exists. Let's write a wrapper function `getEnvVar` to return it is as `None` instead of `null`. 

```fsharp
// ...
open System
// ...

// string -> string option
let getEnvVar name =
  let v = Environment.GetEnvironmentVariable name
  if v = null then None else Some v

let parsePrimitive<'T> ... = ...
```

Then write the functions which use this `getEnvVar` function and parse the value (if it exists) to its specific type.

```fsharp
// (string -> bool * 'a) -> name ->  EnvVarParseResult<'a>
let tryParseWith tryParseFunc name = 
  match getEnvVar name with
  | None -> NotFound name |> Error
  | Some value ->
    match tryParseFunc value with
    | true, v -> Ok v
    | _ -> BadValue (name, value) |> Error


// string -> EnvVarParseResult<int>
let parseInt = tryParseWith Int32.TryParse

// string -> EnvVarParseResult<bool>
let parseBool = tryParseWith Boolean.TryParse

// string -> EnvVarParseResult<string>
let parseString = tryParseWith (fun s -> (true,s))
```

The `tryParseWith` function takes the `tryParseFunc` function of type  `string -> bool * 'a` as its first parameter and the environment variable name as its second parameter. If the environment variable exists, it does the parsing using the provided `tryParseFunc` function and returns either `Ok` with the parsed value or `Error` with the corresponding `EnvVarParseError` value. 

The `parseInt`, `parseBool` and `parseString` functions make use of this `tryParseWith` function by providing it's corresponding parsing functions. 

### Implementing parsePrimitive function

Now we have functions to parse the specific types, and all we need to do now is to leverage them in the `parsePrimitive` function. 

```fsharp
// string -> EnvVarParseResult<'T>
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =
  match shapeof<'T> with
  | Shape.Int32 -> parseInt envVarName
  | Shape.String -> parseString envVarName
  | Shape.Bool -> parseBool envVarName
  | _ -> NotSupported "unknown target type" |> Error
```

Here come the compiler errors!

```
error FS0001: Type mismatch. Expecting a
    'EnvVarParseResult<'T>'
but given a
    'EnvVarParseResult<int>'
The type ''T' does not match the type 'int'
``` 

```
All branches of a pattern match expression must have the same type. 
This expression was expected to have type ''T', but here has type 'string'.
```

```
All branches of a pattern match expression must have the same type. 
This expression was expected to have type ''T', but here has type 'bool'.
```

As the compiler rightly says, we are supposed to return `EnvVarParseResult` of the provided generic target type `'T`. But we are returning `EnvVarParseResult` with specific types `int` or `bool` or `string`. 

We know that these return types are right based on the pattern matching that we do on the shape of `'T` but the compiler doesn't know! It just doing its job based on the type signature that we provided

```fsharp
// string -> EnvVarParseResult<'T>
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> = 
  ...
```

What to do now?

Well, We can solve this by introducing another layer of abstraction[^3]

```fsharp
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =

  // (string -> 'a) -> EnvVarParseResult<'T>
  let wrap(p : string -> 'a) = 
    envVarName
    |> unbox<string -> EnvVarParseResult<'T>> p 

  ... 
```

The `wrap` function introduces a new generic type `'a` and accepts a function that takes a `string` and returns this new generic type `'a`. Then in its function body, it uses the [unbox function](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/operators.unbox%5B't%5D-function-%5Bfsharp%5D) from F# standard library to unwrap the passed parameter function and call this with the given `envVarName`. 

We can make of this `wrap` function to get rid of the compiler errors.

Here is how the completed `parsePrimitive` function would look like 


```fsharp
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =

  let wrap(p : string -> 'a) = 
    envVarName
    |> unbox<string -> EnvVarParseResult<'T>> p 
    
  match shapeof<'T> with
  | Shape.Int32 -> wrap parseInt
  | Shape.String -> wrap parseString
  | Shape.Bool -> wrap parseBool
  | _ -> NotSupported "unknown target type" |> Error
```

We have solved the problem here by wrapping up the specific return types (`EnvVarParseResult<int>`, `EnvVarParseResult<string>`, `EnvVarParseResult<bool>`) to new generic type `'a` and then unboxing it using the already defined generic type `'T`. 

Now the compiler is happy!

Let's try this in F# interactive

```bash
> parsePrimitive<int> "PORT";;
[<Struct>]
val it : EnvVarParseResult<int> = Error(NotFound "PORT")
```

As there is no environment variable with the name `PORT`, we are getting the `NotFound` error as expected.

If we set an environment variable with the given name `PORT`, and try it again, we can see the favourable parsed result!

```bash
> Environment.SetEnvironmentVariable("PORT", "5432");;
val it : unit = ()

> parsePrimitive<int> "PORT";;
[<Struct>]
val it : EnvVarParseResult<int> = Ok 5432
```

Awesome! We achieved the milestone number one!!


## Use Case #2 - Parsing Record Types

Like what we did for the `parsePrimitive` function, let's start with the scaffolding for parsing record types

```fsharp
// unit -> EnvVarParseResult<'T>
let parseRecord<'T> () =
  NotSupported "non record type found" |> Error
```

The first step towards our outcome is matching the data type with the `Shape.FSharpRecord`

```fsharp
let parseRecord<'T> () =
  match shapeof<'T> with
  | Shape.FSharpRecord (:? ShapeFSharpRecord<'T> as shape) ->
    NotSupported "record type support is just started" |> Error
  | _ -> NotSupported "non record type found" |> Error
```

We are doing two things here to pattern match the record type. First, we are matching whether the shape of the provided type `'T` is of shape `Shape.FSharpRecord` and then, whether it can be cast to TypeShape's F# Record representation `ShapeFSharpRecord<'T>`. If both these checks are through, we returning the `NotSupported` error with a message. 

To verify this, Let's create a new record type `Config`.

```fsharp
type Config = {
  ConnectionString : string
  Port : int
  EnableDebug : bool
  Environment : string
}
```
The four fields of this `Config` is going to be populated from their corresponding environment variables in the upcoming steps;


If we try the `parseRecord` with the `Config` type, we will get the error message as expected. 

```bash
> parseRecord<Config> ();;
[<Struct>]
val it : EnvVarParseResult<Config> =
  Error (NotSupported "record type support is just started")
```

### Environment Variable Names of Record fields

Great, now we are able to recognise the record types. The next step is getting all the field names of the provided record type. 

We can get that using the `Fields` field of the `ShapeFSharpRecord<'T>` type. 

```fsharp
let parseRecord<'T> () =
  match shapeof<'T> with
  | Shape.FSharpRecord (:? ShapeFSharpRecord<'T> as shape) ->
    shape.Fields |> Seq.iter (fun field -> printfn "%s" field.Label)
    NotSupported "record type support is just started" |> Error
  | _ -> NotSupported "non record type found" |> Error
```

```bash
> parseRecord<Config> ();;
ConnectionString
Port
EnableDebug
Environment
val it : EnvVarParseError = ...
```

The next step is transforming these field names to its corresponding environment variable names. A typical environment variable name convention is an upper case string with multiple words separated by the underscore character. For example, `CONNECTION_STRING` would be environment variable name from which we need to retrieve the value of the `ConnectionString` field of `Config` type. 

```fsharp
// ...
open System.Text.RegularExpressions
// ...

let envVarNameRegEx = 
  Regex("([^A-Z]+|[A-Z][^A-Z]+|[A-Z]+)", RegexOptions.Compiled)

let canonicalizeEnvVarName name =
  let subStrings =
    envVarNameRegEx.Matches name
    |> Seq.cast
    |> Seq.map (fun (m : Match) -> m.Value.ToUpperInvariant())
    |> Seq.toArray
  String.Join("_", subStrings)

let parseRecord<'T> () =
  match shapeof<'T> with
  | Shape.FSharpRecord (:? ShapeFSharpRecord<'T> as shape) ->
    shape.Fields 
    |> Seq.iter (fun field -> canonicalizeEnvVarName field.Label |> printfn "%s")
    ...
```

The `envVarNameRegEx` uses three alternatives and returns substrings which satisfy any of these alternatives. You can learn more about the regular expression being used here by inputting the `([^A-Z]+|[A-Z][^A-Z]+|[A-Z]+)` value in the [Regex101](https://regex101.com/) website. 

The `canonicalizeEnvVarName` function gets all the matched substring of `envVarNameRegEx`, then transforms each substring to its uppercase format, and then joins all of them with `_` to return it as a `string`. 

Now if we try the `parseRecord` again, we can see environment variable names for all fields.

```bash
> parseRecord<Config> ();;
CONNECTION_STRING
PORT
ENABLE_DEBUG
ENVIRONMENT
val it : EnvVarParseError = ...
```

To use the `parsePrimitive` function that we created in the previous section, we need two things, the primitive type and the environment variable name. Here we have environment variable name. The next step is figuring out the primitive type of each field in the record type!

### Parsing Record Fields

Let's start with an initial function `parseRecordField` which is going to be called for populating the individual fields of the record type. 

```fsharp
// parseRecordField -> string
let private parseRecordField (shape : IShapeWriteMember<'RecordType>) = 
  "TODO"
```
> The `private` access modifier is required as the `IShapeWriteMember<'T>` is declared as `internal`. We can use `internal` instead of `private` as well.

Then call this from the `parseRecord` function for each field. 

```diff
let parseRecord<'T> () =
  match shapeof<'T> with
  | Shape.FSharpRecord (:? ShapeFSharpRecord<'T> as shape) ->
    shape.Fields
-   |> Seq.iter (fun f -> parseRecordField f |> printfn "%s")
+   |> Seq.iter (fun field -> canonicalizeEnvVarName field.Label |> printfn "%s")
    NotSupported "record type support just started"
  | _ -> NotSupported "non record type found"
```

The next step is getting the type of the field from the shape and call the `parsePrimitive` function with the field type and the environment variable name that we obtained above.

```fsharp
// IShapeWriteMember<'RecordType> -> string
let private parseRecordField (shape : IShapeWriteMember<'RecordType>) = 
  
  let envVarName = canonicalizeEnvVarName shape.Label

  shape.Accept {
    new IWriteMemberVisitor<'RecordType, string> with
      member __.Visit (shape : ShapeWriteMember<'RecordType, 'FieldType>) =
        match parsePrimitive<'FieldType> envVarName with
        | Ok fieldValue -> 
            sprintf "%A" fieldValue
        | Error e -> 
            sprintf "%A" e
    }
```

There is a lot of things going on the `parseRecordField` function. So, let me explain one by one. 

The interface `IShapeWriteMember` has a method `Accept` with the following signature

```fsharp
IWriteMemberVisitor<'RecordType,'T> -> 'T
```

Here in the `parseRecordField` function, we are partially applying the first argument (an implementation of `IWriteMemberVisitor<'RecordType,'T>` type) and return `'T`. The [Object expression](https://fsharpforfunandprofit.com/posts/object-expressions/) which implements the `IWriteMemberVisitor` interface defines the `'T` type as `string` and hence the `parseRecordField` returns `string` in this case.

The `Visit` method of the `IWriteMemberVisitor` takes care of figuring out the `FieldType` of the given shape for us. So, inside the `Visit` method, we can call the `parsePrimitive` function with the provided `FieldType` and return the result as a `string`. 

Now if we try `parseRecord` in fsharp interactive, we will get the following output.

```bash
> parseRecord<Config> ();;
NotFound "CONNECTION_STRING"
NotFound "PORT"
NotFound "ENABLE_DEBUG"
NotFound "ENVIRONMENT"
val it : EnvVarParseError = NotSupported "record type support just started"
```

If we set an environment variable, and try it again, we the see the success case as well!

```bash
> Environment.SetEnvironmentVariable("PORT", "5432");;
val it : unit = ()

> parseRecord<Config> ();;
NotFound "CONNECTION_STRING"
5432
NotFound "ENABLE_DEBUG"
NotFound "ENVIRONMENT"
val it : EnvVarParseError = NotSupported "record type support just started"
```

Alright! Our next focus is populating the record field if all the corresponding environment variables are available otherwise return the list of errors. 


### Populating Record Fields

The `Inject` method of the `ShapeWriteMember` class takes a value of record type and a value of field type and changes the record's field value with the provided one via reflection. 

To make use of this method, we need to have a value of the record type. As we didn't have it inside the `parseRecordField` function, instead of returning it as a `string`, we can return a function a that takes a record value and call the `shape.Inject` inside it. 

For the error case, we are just passing the error.

```fsharp
// IShapeWriteMember<'RecordType> -> 'RecordType -> EnvVarParseResult<'RecordType>
let private parseRecordField (shape : IShapeWriteMember<'RecordType>) = 
  let envVarName = canonicalizeEnvVarName shape.Label
  shape.Accept {
    new IWriteMemberVisitor<'RecordType, 
                              'RecordType -> EnvVarParseResult<'RecordType>> with

      member __.Visit (shape : ShapeWriteMember<'RecordType, 'FieldType>) =
        match parsePrimitive<'FieldType> envVarName with
        | Ok fieldValue ->          
          fun record -> shape.Inject record fieldValue |> Ok
        | Error e -> 
          fun _ -> Error e
    }
```

Now we have the parsing logic in place for the populating individual record fields, and the one last thing that we need is to prepare an initial value of the record type and call the function returned with `parseRecordField` function with the prepared record. 

In this last step, we also need to collect all the errors!

```fsharp
// 'RecordType -> EnvVarParseError list -> IShapeWriteMember<'RecordType> ->
//     EnvVarParseError list 
let private foldParseRecordFieldResponse record parseRecordErrors field =
  match parseRecordField field record with
  | Ok _ -> parseRecordErrors
  | Error e -> e :: parseRecordErrors
    
// unit -> EnvVarParseResult<'T, EnvVarParseError list>
let parseRecord<'T> () =
  match shapeof<'T> with
  | Shape.FSharpRecord (:? ShapeFSharpRecord<'T> as shape) ->
  
    let record = shape.CreateUninitialized()

    let parseRecordErrors =
      shape.Fields
      |> Seq.fold (foldParseRecordFieldResponse record) []
    match List.isEmpty parseRecordErrors with 
    | true -> Ok record 
    |_  -> Error parseRecordErrors
  | _ -> NotSupported "non record type found" |> Error
```

Using the `CreateUninitialized` method of the `ShapeFSharpRecord` class, we are creating an initial value of the provided record type. Then using the [fold function](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/seq.fold%5B't,'state%5D-function-%5Bfsharp%5D), we are populating its fields using the `parseRecordField` function. 

That's it!

If we run the `parseRecord<'T>` without setting any environment variable, we will get the following output

```bash
> parseRecord<Config> ();;
[<Struct>]
val it : Result<Config,EnvVarParseError list> =
  Error
    [NotFound "ENVIRONMENT"; NotFound "ENABLE_DEBUG"; NotFound "PORT";
     NotFound "CONNECTION_STRING"]
```

And if we have all the environment variables in place, we will be getting the following output

```bash
> parseRecord<Config> ();;
[<Struct>]
val it : Result<Config,EnvVarParseError list> =
  Ok {ConnectionString = "Database=foobar;Password=foobaz";
      Port = 5432;
      EnableDebug = true;
      Environment = "staging";}
```

Awesome! We made it!!


## Summary

In this blog post, we have learned how to do generic programming involving reflection in F# using the TypeShape library. We have also learned how to build reusable abstraction in F# in an incremental fashion. 

I am planning to release this as a NuGet library supporting both environment variables and application config file variables in sometime soon. Looking forward to listening to your comments to make it better. 

The source code is available in my [GitHub](https://github.com/tamizhvendan/FsEnvConfig) repository.

Wish you an advanced Merry Christmas :christmas_tree:  and happy new 2018 :tada:

[^1]: From [WikiPedia](https://en.wikipedia.org/wiki/Generic_programming)
[^2]: Copied From Eirik Tsarpalis's [Slide](http://eiriktsarpalis.github.io/typeshape/#/12)
[^3]: Fundamental theorem of software engineering - [WikiPedia](Fundamental theorem of software engineering)