---
title: "Model Binding in Suave and Saturn"
date: 2018-12-17T20:50:23+05:30
tags: ["fsharp", "suave", "saturn"]
---

In one of the fsharp project that I was part of in early this year, we encountered an interesting scenario where we need to do serialisation of a fsharp record type from the query string (and multi-part form) in [Suave](https://www.suave.io), and the out of the box model binding support didn't suit our requirements. 

So, we rolled out our own, and the solution came from a library which was not intended to solve this problem. In this blog post, I will be sharing what the problem was and how we solved it. The solution that we came up with is not limited to Suave alone, and it can be used in [Saturn](https://saturnframework.org/) and [Giraffe](https://github.com/giraffe-fsharp/Giraffe) as well.

> This blog post is a part of fsharp [advent calendar 2018](https://sergeytihon.com/2018/10/22/f-advent-calendar-in-english-2018/).


## The Problem Statement

Let's assume that we have the following fsharp types to represent the filter criteria of an e-commerce portal that sells books.

```fsharp
type DealsCategory =
| AllDeals
| AllEBooks
| ActionAndAdventure
| Media
| Fiction

type Language =
| English
| Hindi
| Tamil

type Rating =
| Five
| FourAndAbove
| ThreeAndAbove

type SearchFilter = {
  Languages : Language list
  Rating : Rating option
}

type Search = {
  Category : DealsCategory
  Filter : SearchFilter
}
```

The record type `Search` represents the data that we'll be receiving from the front-end as a query string. 

```bash
curl 'http://localhost:8080/books?category=Fiction&rating=Five&languages=Tamil&languages=English'
```

In Suave, model binding support is provided using the [Suave.Experimental](https://www.nuget.org/packages/Suave.Experimental/) package and it currently supports only binding form values as mentioned in [this blog post](http://vgaltes.com/post/forms-with-suave-experimental-and-suave-forms/). However, the form binding logic in this package can be extended by replacing `req.formData` with `req.query` in [this file](https://github.com/SuaveIO/suave/blob/v2.5.3/src/Suave.Experimental/Form.fs#L118) (you need to copy and paste the code in your project!). A significant limitation was it supports record types with only `String`, `Decimal`, `DateTime`, `MailAddress` types for model binding. 

The model binding in the Saturn framework (using [Giraffe](https://github.com/giraffe-fsharp/Giraffe/blob/master/DOCUMENTATION.md#binding-query-strings)) doesn't have these limitations, and it also supports Discriminated Union Types that has cases alone. Unfortunately, it doesn't support nested records out of the box. It is one of the critical requirement for us as many of our view model's fields are record types. 

Let's find a solution to this!

## Model Binding

The model binding logic that we wanted to develop should conceptually work like this

![](/img/fsharp/blog/model-binding/model-binding.png)

It takes three input, 

1. The record type that it wants to bind
2. A value store (query string or form field) to get the values for the fields of the given record type.
3. A field name canoncializer to fix the field name transformations like PascalCasing to CamelCasing  (`Languages` to `languages`)


Then it iterates all the fields in the record type, and for each field name, it calls the field name canoncializer to get the corresponding field name in the value store and finally get the value of the given field name from the value store. 

If the above operation is successful for all the fields, it should return the value of the given record type else return an appropriate error. 

After whiteboarding this stuff out, it struck that I was doing a similar logic in the [FsConfig](https://github.com/demystifyfp/FsConfig) (an F# library for reading configuration data from environment variables and AppSettings) and I can use it use it here! 

In FsConfig, the model binding logic reads the value from the environment variables or the application settings file. Here we need to read from query strings or form fields!

## Suave Solution Using FsConfig

The `parse` [function](https://github.com/demystifyfp/FsConfig/blob/2.0.2/src/FsConfig/Config.fs#L280) in the FsConfig library has the following function signature

```fsharp
IConfigReader -> FieldNameCanonicalizer -> string -> 'T
```

The `parse` function takes three parameters

[1] The `IConfigReader` interface represents the value store in the above diagram.

```fsharp
type IConfigReader =
  // given a key, return its value if it exists or none
  abstract member GetValue : string -> string option
```

[2] The `FieldNameCanonicalizer` is a function.

```fsharp
type Prefix = Prefix of string
type FieldNameCanonicalizer = Prefix -> string -> string
```
The first parameter represents the prefix which will be either empty or the field name if the corresponding field is a record type. The second parameter is the actual field name. 

[3] The third parameter is the custom prefix that you may want to prefix for all the fields of the parent record. (Typical environment variables uses some prefix for namespacing like `MYAPP_PORT`)

To make it work for Suave, we need to provide appropriate values for these parameters.

The first parameter is `IConfigReader`. 

```fsharp
// HttpRequest -> Map<string, string>
let queryStringsMap (request : HttpRequest) =
  request.query
  |> List.groupBy fst
  |> List.map (fun (x, keyVals) -> 
                (x, keyVals 
                    |> List.map snd 
                    |> List.choose id 
                    |> String.concat ","))
  |> Map.ofList

// IConfigReader
type HttpQueryStringsProvider(request : HttpRequest) =
    // value store for query string
    let queryStringsMap = queryStringsMap request

    interface IConfigReader with
      // retrieving the value from the query string
      member __.GetValue name =
        Map.tryFind name queryStringsMap
```

The second parameter is `FieldNameCanonicalizer`.

```fsharp
// PascalCase to camelCase
let private camelCaseCanonicalizer _ (name : string) =
  name
  |> String.mapi (fun i c ->
      if (i = 0) then Char.ToLowerInvariant c else c)
```

> We are ignoring the prefix here as we are using are not going to use it.

The final parameter is custom prefix which is a blank string in our case as we are not using any custom prefix. 

With these things in place, we can create a new function called `bindQueryStrings` which does the model binding using the FsConfig's `parse` function.

```fsharp
// HttpRequest -> Result<'T, string>
let bindQueryStrings<'T> (request : HttpRequest) =
  let queryStringsProvider = new HttpQueryStringsProvider(request)
  parse<'T> queryStringsProvider camelCaseCanonicalizer ""
  |> Result.mapError (fun e -> e.ToString())
```

To see it in action, wire it up in a webpart

```fsharp
let getBooks ctx = async {
  let search = bindQueryStrings<Search> ctx.request
  // just printing it for brevity
  printfn "%A" search
  return! Successful.OK "Todo" ctx
}

let app =
  path "/books" >=> getBooks

[<EntryPoint>]
let main argv = 
  startWebServer defaultConfig app
  0
```

## Saturn Solution Using FsConfig

The solution in Saturn using FsConfig will be very similar. We need to use HTTP models specific to Saturn to retrieve the query string values.

```fsharp
type QueryStringReader(ctx : HttpContext) =
  interface IConfigReader with
    member __.GetValue name =
      printfn "--> %s" name
      match ctx.Request.Query.TryGetValue name with
      | true, x -> Some (x.ToString())
      | _ -> None

let bindQueryStrings<'T> (ctx : HttpContext) =
  let reader = new QueryStringReader(ctx)
  parse<'T> reader camelCaseCanonicalizer ""
```

And then use it like below

```fsharp
let getBooks (ctx : HttpContext) = task {
  let search = bindQueryString<Search> ctx
  // just printing it for brevity
  printfn "%A" search
  return! Controller.text ctx "TODO"
}

let bookController = controller {
  index getBooks
}

let apiRouter = router {
  forward "/books" bookController
}

let app = application {
    use_router apiRouter
    url "http://0.0.0.0:8080"
}

[<EntryPoint>]
let main _ =
  run app
```

## Summary

Tomas Petricek once wrote an excellent blog post on [library vs frameworks](http://tomasp.net/blog/2015/library-frameworks/) where he encourages us to focus on using libraries which can be plugged to any code to solve the problems. The effort that we did here remind me of this blog post and it was amazing that it fits well with both Suave and Saturn. 


This model binding logic can be extended to bind the data from anywhere even from a database like [Slapper.AutoMapper](https://github.com/SlapperAutoMapper/Slapper.AutoMapper). It has some loose ends. If I get some time to fix those quirks, I am planning to release this as a separate library. 

You can find the source code associated with this blog post in my [GitHub repository](https://github.com/demystifyfp/BlogSamples/tree/0.12/fsharp/ModelBinding).
