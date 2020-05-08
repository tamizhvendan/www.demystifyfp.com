---
title: "Concurrent Programming in fsharp Using Hopac - Part 5"
date: 2018-03-20T17:13:48+05:30
tags : ["fsharp", "Hopac", "concurrent-programming"]
---

Hi,

In the [last blog post]({{< relref "concurrent-programming-in-fsharp-using-hopac-part-4.mmark">}}), we learned how `Alt` in Hopac works and its applications. In this blog post, we are going to apply what we learned so far by creating a Ticker.

Using ticker we can do something repeatedly at regular intervals.

To implement a Ticker in Hopac, we have to know one more abstraction in Hopac called `IVar`. So, in the first section, we are going to learn `IVar` and then we'll use it to implement Ticker.

Let's dive in


## The IVar type

In a nutshell, `IVar` represents a write-once variable.

> Write once variables are designed for and most commonly used for getting replies from concurrent servers and asynchronous operations, but can also be useful for other purposes such as for one-shot events and for implementing incremental, but immutable, concurrent data structures.

> Because it is common to need to be able to communicate either an expected successful result or an exceptional failure in typical use cases of write once variables, direct mechanisms are provided for both. The implementation is optimized in such a way that the ability to report an exceptional failure does not add overhead to the expected successful usage scenarios.

> Write once variables are lightweight objects and it is typical to always just create a new write once variable when one is needed. In most cases, a write once variable will be slightly more lightweight than a channel. This is possible because write once variables do not support simple rendezvous like channels do. When simple rendezvous is necessary, a channel should be used instead. - **Hopac Documentation**

The `IVar<'a>` type is a subclass of `Promise<'a>` which in turn a subclass of `Alt<'a>`.

Let's see `IVar` in action to learn it better



```fsharp
open Hopac

// IVar<'a> -> 'a -> unit
let fillAndRead iVar value =
  IVar.fill iVar value // Job<unit> // <1>
  |> Job.bind (fun _ -> IVar.read iVar) // Job<unit> // <2>
  |> Job.map (printfn "%A") // Job<unit>
  |> run // unit
```

As the name indicates, the `fillAndRead` is a function fills the given write-once variable `iVar` with the provided `value`, and then reads the `value` from the `iVar`.

<1> The `IVar.fill` function creates a job that writes the given value to the given write-once variable.
```fsharp
val fill: IVar<'x> -> 'x -> Job<unit>
```

<span class="callout">2</span> The `IVar.read` function creates an alternative that becomes available when the write-once variable had a value.
```fsharp
val read: IVar<'x> -> Alt<'x>
```

Executing the `fillAndRead` function as below
```fsharp
fillAndRead (IVar<bool>()) true
fillAndRead (IVar<bool>()) false
```
will give the following output
```bash
> fillAndRead (IVar<bool>()) true
- fillAndRead (IVar<bool>()) false
- ;;
true
false
val it : unit = ()
```

The `IVar.fill` function would return an exception if the `IVar` variable were already filled.

We can verify this by defining a new `IVar` value `intIVar` and using this to call the `fillAndRead` twice

```fsharp
let intIVar = IVar<int>()
fillAndRead intIVar 42
```
Executing the above two lines will yield the below output
```bash
> let intIVar = IVar<int>()
- fillAndRead intIVar 42
- ;;
42
val intIVar : IVar<int>
val it : unit = ()
```

And then calling `fillAndRead` function with `intIVar` will have the following output
```bash
> fillAndRead intIVar 10
- ;;
Unhandled exception: System.Exception: IVar full
No other causes.
val it : unit = ()
```

If we don't want any exception to be thrown while filling a `IVar` value, we can make use of `IVar.tryFill` function, which creates a job that tries to write the given value to the given write-once variable. No operation takes place, and no error is reported in case of the write-once variable has already been written.

```fsharp
val tryFill: IVar<'x> -> 'x -> Job<unit>
```

Let's write a another function `tryFillAndRead` which exactly does what `fillAndRead` function did except the usage of `IVar.fill` function.

```fsharp
let tryFillAndRead iVar value =
  IVar.tryFill iVar value
  |> Job.bind (fun _ -> IVar.read iVar)
  |> Job.map (printfn "%A")
  |> run
```

With this, if we try the above example with the `tryFillAndRead` function

```fsharp
let anotherIntIVar = IVar<int>()
tryFillAndRead anotherIntIVar 42
tryFillAndRead anotherIntIVar 10
```

We won't get any error and the value that we use to fill for the second time will be silently ignored.

```bash
> let anotherIntIVar = IVar<int>()
- tryFillAndRead anotherIntIVar 42
- tryFillAndRead anotherIntIVar 10
- ;;
42
42
val anotherIntIVar : IVar<int>
val it : unit = ()
```

The last thing that we need to explore before getting into the implementation of Ticker is, the return type of `IVar.read` function is `Alt<'a>`.

So, we can use it to choose use between any other `Alt`.

Say, for example, if we want a `IVar` value to be available in a certain amount of time and do something else if it didn't become available, we can achieve it like this.


```fsharp
open Hopac.Infixes

// int -> IVar<'a> -> unit
let readOrTimeout delayInMillis iVar =

  let timeOutAlt = // Alt<unit>
    timeOutMillis delayInMillis
    |> Alt.afterFun (fun _ -> printfn "time out!") // <1>

  let readAlt = // Alt<unit>
    IVar.read iVar
    |> Alt.afterFun (printfn "%A") // <2>

  timeOutAlt <|> readAlt // <3>
  |> run
```

<1> `Alt<unit>` that prints a time-out after given time delay

<2> Prints the value of `iVar` as soon as it is available

<3> Chooses between `timeOutAlt` and `readAlt` and commits to whatever completes first

If we fill a `iVar` value and run this function

```fsharp
let yetAnotherIntIVar = IVar<int>()
tryFillAndRead yetAnotherIntIVar 10
readOrTimeout 1000 intIVar
```

We can see the value of `IVar` in the output.

```bash
> let yetAnotherIntIVar = IVar<int>()
- tryFillAndRead yetAnotherIntIVar 10
- readOrTimeout 1000 intIVar
- ;;
10
10
val yetAnotherIntIVar : IVar<int>
val it : unit = ()
```

If we try the `readOrTimeout` function, with a new `IVar` value, we will see the time-out message

```fsharp
#time "on"
readOrTimeout 2000 (IVar<unit>())
#time "off"
```

```bash
--> Timing now on
time out!
Real: 00:00:02.001, CPU: 00:00:00.004, GC gen0: 0, gen1: 0
val it : unit = ()
--> Timing now off
```

With this, we are wrapping up our exploration on `IVar`.


## The Ticker Type

The `Ticker` type that we are going to implement will have the following signature.


```fsharp
type Ticker =
  class
    new : timeSpan:TimeSpan -> Ticker // <1>
    member Stop : unit -> unit // <2>
    member C : Ch<DateTimeOffset> // <3>
  end
```

<1> The `Ticker` type is a class with a constructor that takes a `TimeSpan` to specify the interval.

<2> It is going to have a `Stop` function which stops the ticker.

<3> The member `C` exposes a channel which gives a `DateTimeOffset` value at regular intervals specified by the `TimeSpan`.

We are going to hide the complexity of a ticker behind this `Ticker` type.


```fsharp
open Hopac
open Hopac.Infixes
open System

type Ticker (timeSpan : TimeSpan) =

  // Ch<DateTimeOffset>
  let tickCh = Ch<DateTimeOffset>() // <1>

  // IVar<unit>
  let cancelled = IVar() // <2>

  // unit -> Alt<unit>
  let tick () = // <3>
    Ch.give tickCh DateTimeOffset.Now

  // unit -> Alt<unit>
  let rec loop () = // <4>
    // Alt<unit>
    let tickerLoop =
      timeOut timeSpan
      |> Alt.afterJob tick
      |> Alt.afterJob loop
    tickerLoop <|> IVar.read cancelled

  do start (loop()) // <5>

  // unit -> unit
  member __.Stop() =
    IVar.tryFill cancelled () |> start // <6>

  // Ch<DateTimeOffset>
  member __.C
    with get() = tickCh // <7>
```

<1> A `Ticker` channel `tickCh` initialised as private value.

<2> A `IVar` private value `cancelled` to keep track of the Ticker's state

<3> The `tick` function defines what to do on a tick. We are getting the [current date time offset](https://msdn.microsoft.com/en-us/library/system.datetimeoffset.now.aspx) and give it to the outside world via the `tickCh`.

<4> The recursive function `loop` is the crux of our `Ticker` implementation that defines a loop function that will keep calling the `tick` function at the specified interval `timeSpan` until a value available on `cancelled` IVar.

The `timeOut` function is similar to `timeOutMillis` function except it takes a `TimeSpan` instead of milliseconds as an `int`.

<5> We are kickstarting the loop function here. It will be invoked during the execution of the constructor.

<6> The `Stop` method tries to fill the `IVar` value `cancelled`, and it starts at a new `job`.

<7> Finally, we are exposing the `tickCh` as a getter member `C`.

## The Ticker type in action

#### Use Case #1

Our first use case is, executing a function repeatedly at an interval of `x` seconds for `n` times.

This use case can be implemented as


```fsharp
// int -> int -> (DateTimeOffset -> unit) -> unit
let useCase1 nTimes (xSeconds : int) f =
  let timeSpan =
    xSeconds |> float |> TimeSpan.FromSeconds
  let ticker = new Ticker(timeSpan)

  ticker.C // Ch<DateTimeOffset>
  |> Alt.afterFun f // Alt<unit> // <1>
  |> Job.forN nTimes // Job<unit> // <2>
  |> run
  ticker.Stop()
```

<1> Upon a tick on the `Ticker` channel, we are calling the provided function `f`.

<2> The `Job.forN` function creates a job that runs the given job sequentially the given number of times.
```fsharp
val forN: int -> Job<unit> -> Job<unit>
```
Here the *given job* is receiving value on the ticker channel and invoking the function `f` with the received value.

Let's try this out in fsharp interactive to print the Ticker's tick time.

```bash
> useCase1 5 2 (printfn "%A");;
21-03-2018 19:24:48 +05:30
21-03-2018 19:24:50 +05:30
21-03-2018 19:24:52 +05:30
21-03-2018 19:24:54 +05:30
21-03-2018 19:24:56 +05:30
val it : unit = ()
```

## Use Case #2

The second use case is running two tickers at the different time interval for `x` milliseconds overall.

As a first step, let's create a `ticker` function that creates a Ticker which ticks at given `seconds`

```fsharp
// int -> Ticker
let ticker seconds =
  seconds
  |> float
  |> TimeSpan.FromSeconds
  |> Ticker
```

Then implement use case #2 as below


```fsharp
// int -> int -> int -> unit
let useCase2 t1Interval t2Interval xMillis =
  let ticker1 = ticker t1Interval
  let ticker2 = ticker t2Interval

  let onTick tCh name loop = // <1>
    tCh
      |> Alt.afterFun (fun t -> printfn "[%s] at %A" name t)
      |> Alt.afterJob loop

  // unit -> Alt<'a>
  let rec loop () = // <2>
    onTick ticker1.C "T1" loop <|> onTick ticker2.C "T2" loop

  printfn "Starts at %A" (DateTimeOffset.Now)
  start (loop()) // <3>

  let onTimeOut _ = // <4>
    ticker1.Stop()
    ticker2.Stop()

  timeOutMillis xMillis // <5>
  |> Alt.afterFun onTimeOut
  |> run
  printfn "Ends at %A" (DateTimeOffset.Now)
```

<1> The `onTick` function takes a channel, the ticker's name and a loop function. Upon receiving the `DateTimeOffset` value on the ticker, it prints it along with the ticker's name and then calls the provide `loop` function

<2> The recursive function `loop` chooses between two tickers channel and commits to the one that has a value and then calling itself via the `onTick` function.

<3> We are starting the Job returned by the `loop` function as a separate job.

<4> The `onTimeOut` function stops the tickers upon timeout.

<5> Finally, we wait for the given `x` milliseconds and call the `onTimeOut` function after the timeout.

Executing this F# interactive will give us the similar output

```bash
> useCase2 1 2 5000;;
Starts at 21-03-2018 19:46:36 +05:30
[T1] at 21-03-2018 19:46:37 +05:30
[T2] at 21-03-2018 19:46:38 +05:30
[T1] at 21-03-2018 19:46:38 +05:30
[T1] at 21-03-2018 19:46:39 +05:30
[T2] at 21-03-2018 19:46:40 +05:30
[T1] at 21-03-2018 19:46:40 +05:30
[T1] at 21-03-2018 19:46:41 +05:30
Ends at 21-03-2018 19:46:41 +05:30
val it : unit = ()
```

## Summary

In this blog post, we built a Ticker abstraction using the fundamental ideas provided by Hopac. And then using the ticker, we saw how to implement two different use cases.

Just like composing functions together here we are composing the jobs and implementing complicated stuff with less code.

You can find the source code associated with this blog post on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.7/fsharp/HopacSeries/Part5)
