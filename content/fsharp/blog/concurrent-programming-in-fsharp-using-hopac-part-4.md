---
title: "Concurrent Programming in fsharp using Hopac - Part 4"
date: 2018-03-16T08:46:01+05:30
tags : ["fsharp", "Hopac", "concurrent-programming"]
---

Hi,

Welcome back to the fourth part of Concurrent Programming in fsharp blog post series. In [part-2]({{< relref "concurrent-programming-in-fsharp-using-hopac-part-2.mmark#a-communicating-job-in-action" >}}), we just learned that `Alt<'a>` is a subclass of `Job<'a>`. In this blog post, we are doing to dive deep into this abstraction and learn what it brings to the table.


## An Example

Before diving into the definition of `Alt<'a>`, let's figure out why we need it in the first place.

Assume that we have a function `delayedPrintn` which prints a given message after `n` milliseconds

```fsharp
open Hopac

// string -> int -> Job<unit>
let delayedPrintn msg delayInMillis =
  timeOutMillis delayInMillis
  |> Job.map (fun _ -> printfn "%s" msg)
```

Executing this function in F# interactive,

```fsharp
#time "on"
delayedPrintn "Hi" 3000 |> run
#time "off"
```


will give us the following output

```bash
--> Timing now on
Hi
Real: 00:00:03.000, CPU: 00:00:00.002, GC gen0: 0, gen1: 0
val it : unit = ()
--> Timing now off
```

Nothing fancy and it worked as expected.

Let's make it little complicated by defining two more jobs to print `Hi` and `Hello` after waiting for `2000` and `1000` milliseconds respectively.

```fsharp
// Job<unit>
let delayedHiPrinter = delayedPrintn "Hi" 2000

// Job<unit>
let delayedHelloPrinter = delayedPrintn "Hello" 1000
```

Then define a function to run these two jobs in parallel using the infix operator function `<*>` from `Hopac.Infixes` module.

```fsharp
open Hopac.Infixes

let runThemParallel () =
  delayedHiPrinter <*> delayedHelloPrinter
  |> run |> ignore
```

If we run this function in F# interactive,

```fsharp
#time "on"
runThemParallel ()
#time "off"
```

We can witness that the jobs were executed parallelly and print the output as expected.

```bash
--> Timing now on
Hello
Hi
Real: 00:00:02.004, CPU: 00:00:00.006, GC gen0: 0, gen1: 0
val it : unit = ()
--> Timing now off
```


And here comes the new requirement!

Given we have two printers like the above, if one printer completes its job, stop the other from executing it.

That's interesting! Let's explore how can we solve this


## The Alt Type

> `Alt` represents a first-class selective synchronous operation. The idea of alternatives is to allow one to introduce new selective synchronous operations to be used with non-determinic choice.

>Obviously, when you have a concurrent server that responds to some protocol, you don't have to perform the protocol as a selective synchronous operation.

>However, if you do encapsulate the protocol as a selective synchronous operation, you can then combine the operation with other selective synchronous operations. That is the essence of Hopac and CML. - [Hopac Documentation](https://hopac.github.io/Hopac/Hopac.html#def:type%20Hopac.Alt)

The critical point that we are interested in to solve our problem is `selective`. In other words, among the two printers, we are concerned (selective) in the one which prints first.

The function that can help us here is `Alt.choose`

> `Alt.choose` creates an alternative that is available when any one of the given alternatives is
```fsharp
val choose: seq<#Alt<'x>> -> Alt<'x>
```

As we are dealing with only two `Alt`s, we are going to make use of `<|>` operator function which is an optimised version of calling the `choose` function with a sequence of two items.

> `<|>` creates an alternative that is available when either of the given alternatives is available. xA1 <|> xA2 is an optimized version of choose [xA1; xA2].
```fsharp
val ( <|> ): Alt<'x> -> Alt<'x> -> Alt<'x>
```
> The given alternatives are processed in a left-to-right order with short-cut evaluation. In other words, given an alternative of the form first <|> second, the first alternative is first instantiated and, if it is available, is committed to and the second alternative will not be instantiated at all.

## Revisting delayedPrintn function

The `delayedPrintn` function is returning `Job<unit>` function now.

```fsharp
val delayedPrintn: string -> int -> Job<unit>
```

To apply `<|>` operator function, we need to modify it to return `Alt<unit>`. The `timeOutMillis` function is already returning `Alt<unit>`

```fsharp
val timeOutMillis: int -> Alt<unit>
```

But the `Job.map` function transforming it to `Job<unit>`

```fsharp
val map: ('x -> 'y) -> Job<'x> -> Job<'y>
```

```fsharp
let delayedPrintn msg delayInMillis =
  timeOutMillis delayInMillis // Alt<unit>
  |> Job.map (fun _ -> printfn "%s" msg) // Job<unit>
```

> Alt<'a> is a subclass of Job<'a>

To achieve what we are doing with `Job.map`, we can make use of the `Alt.afterFun` function

```fsharp
val afterFun: ('x -> 'y) -> Alt<'x> -> Alt<'y>
```

```diff
- // string -> int -> Job<unit>
+ // string -> int -> Alt<unit>
  let delayedPrintn msg delayInMillis =
    timeOutMillis delayInMillis // Alt<unit>
-   |> Job.map (fun _ -> printfn "%s" msg) // Job<unit>
+   |> Alt.afterFun (fun _ -> printfn "%s" msg) // Alt<unit>
```


Then we can make use of the `<|>` operator function to choose between the two printers.

```fsharp
// unit -> unit
let chooseBetweenThem () =
  delayedHiPrinter <|> delayedHelloPrinter
  |> run
```

If we execute the `chooseBetweenThem` function with the timer on in F# interactive,

```fsharp
#time "on"
chooseBetweenThem ()
#time "off"
```

We can verify that it only prints `Hello` after a seconds delay

```bash
--> Timing now on
Hello
Real: 00:00:01.002, CPU: 00:00:00.004, GC gen0: 0, gen1: 0
val it : unit = ()
--> Timing now off
```

Awesome!!

Wait what is happening behind the scene? Was the `delayedHiPrinter` called?

Yes, It is. But as soon as the `delayedHelloPrinter` completes its execution, the `<|>` function stops the execution of `delayedHiPrinter` and hence we don't see `Hi` in the output.

To verify this, we can modify the `delayedPrintn` as below, which prints a log message when printer started its execution

```fsharp
// string -> int -> Alt<unit>
let delayedPrintn msg delayInMillis =
  Alt.prepareFun <| fun _ ->
    printfn "starting [%s]" msg
    timeOutMillis delayInMillis
    |> Alt.afterFun (fun _ -> printfn "%s" msg)
```


The `Alt.prepareFun` function that we used here creates an alternative that is computed at instantiation time with the given anonymous function

```fsharp
val prepareFun: (unit -> Alt<'x>) -> Alt<'x>
```

If we execute the function `chooseBetweenThem` now, we'll get the following output

```fsharp
--> Timing now on
starting [Hi]
starting [Hello]
Hello
Real: 00:00:01.006, CPU: 00:00:00.005, GC gen0: 0, gen1: 0
val it : unit = ()
--> Timing now off
```


## Negative Acknowledgement

In the above section, we didn't care about the `delayedHiPrinter` and ignored it completely. But in particular real-world use cases, we can't afford an execution to be stopped abruptly. In those cases, we need to let the `Alt<'a>` know about this situation.

To implement this kind of scenarios, Hopac offers [Negative Acknowledgement](https://github.com/Hopac/Hopac/blob/master/Docs/Alternatives.md#cancellation-with-negative-acknowledgments).

To implement this behaviour in our example, let's create an another function `delayedPrintnWithNack` which wraps the `delayedPrintn` with the negative acknowledgement support.


```fsharp
// string -> int -> Alt<unit>
let delayedPrintnWithNack msg delayInMillis =

  // Alt<'a> -> Alt<unit>
  let onNack nack =  // <1>
    nack
    |> Alt.afterFun (fun _ -> printfn "aborting [%s]" msg)

  Alt.withNackJob <| fun nack -> // <2>
    Job.start (onNack nack) // <3>
    |> Job.map (fun _ -> delayedPrintn msg delayInMillis) // <4> // Job<Alt<unit>>
```

There is a lot is happening in this short code snippet. So, Let's dissect it.


<1> We are defining an `onNack` function to specify what to do in the event of a negative acknowledgement. For simplicity we are just printing an abort message.

<2> To make any `Alt<'a>` negative acknowledgement aware, Hopac provides a function called `Alt.withNackJob`.
> ```fsharp
val withNackJob: (Promise<unit> -> Job<Alt<'x>>) -> Alt<'x>
```
> The `withNackJob` function creates an alternative that is computed at instantiation time with the given job constructed with a negative acknowledgement alternative.

> `withNackJob` allows client-server protocols that do require the server to be notified when the client aborts the transaction to be encapsulated as selective operations.

> The negative acknowledgement alternative will be available in case some other instantiated alternative involved in the choice is committed to instead. - **Hopac Documentation**

> `Promise<'a>` is a sub class of `Alt<'a>`, which we'll see in detail in a later blog post

<span class="callout">3</span> Using the `Job.start` function, we are immediately starting the `onNack` job in an another concurrent job
> ```fsharp
val start: Job<unit> -> Job<unit>
```

<span class="callout">4</span> After starting the `onNack` job, we are calling the actual `delayedPrintn` and return its result.

Let's verify this behaviour with a new set of function.


```fsharp
let delayedHiPrinterWithNack =
  delayedPrintnWithNack "Hi" 2000

let delayedHelloPrinterWithNack =
  delayedPrintnWithNack "Hello" 1000

let chooseBetweenThemWithNack () =
  delayedHiPrinterWithNack <|> delayedHelloPrinterWithNack
  |> run

#time "on"
chooseBetweenThemWithNack ()
#time "off"
```

```bash
--> Timing now on

starting [Hi]
starting [Hello]
Hello
aborting [Hi]
Real: 00:00:01.000, CPU: 00:00:00.001, GC gen0: 0, gen1: 0
val it : unit = ()

--> Timing now off
```

From the log that we can assert that we gracefully handled the negative acknowledgement.

Here is my best effort to show what is happening in the `delayedPrintnWithNack` function

![](/img/fsharp/blog/hopac/nack.png)

## Summary

In this blog post, we explored how to implement selective synchronisation in Hopac using `Alt`. It is fascinating to experience that we can write harder concurrent programs with less code.

Stay tuned for the upcoming blog posts. We are going to build some awesome stuff using `Alt`.

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.6/fsharp/HopacSeries/Part4)



