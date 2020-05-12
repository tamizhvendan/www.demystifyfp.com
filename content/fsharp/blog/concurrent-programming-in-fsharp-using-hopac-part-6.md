---
title: "Concurrent Programming in Fsharp Using Hopac - Part 6"
date: 2018-04-25T21:03:26+05:30
tags : ["fsharp", "Hopac", "concurrent-programming"]
type: "post"
reading_time: true
---

Hi there!

Welcome back to the sixth part of my blog series on concurrent programming in fsharp. In this part, we are going to learn how to deal with state changes while doing concurrent programming through a fun example.

## Time Bomb Simulator

The example that we are going to see is a time bomb simulator. The time bomb transitions through different states as shown below during its lifecycle.

![](/img/fsharp/blog/hopac/timebomb_state_transition.png)

The associated fsharp type `TimeBomb` will have the following signature

```fsharp
type TimeBomb =
  class
    new : unit -> TimeBomb
    member Activate : seconds:int * defuseChar:char -> unit
    member Status : unit -> Status
    member TryDefuse : defuseChar:char -> unit
    member DeadStatusAlt : Hopac.Alt<Reason>
    member SecondsRemainingCh : Hopac.Ch<int>
  end
```

The time bomb will be initially in *NotActivated* state and moves to *Alive* state on a method call `Activate`. In this method call, we are going to specify the seconds that the time bomb has to wait before triggering the detonation. To support defuse, we are also going to define a unique character which defuses an alive time bomb.

In *Alive* state, the time bomb sends the seconds remaining to the outside world via a Hopac Channel `SecondsRemainingCh`. While it is alive, we can call the `TryDefuse` with any character to defuse it.

If the specified character in the `TryDefuse` method matches with the character that we provided during activation, the time bomb will go the `Dead` state with the value `Defused`.

If none of the attempt succeeds in the stipulated time, the time bomb will go the `Dead` state with the value `Exploded`.

The dead status change is communicated through `DeadStatusAlt`.

## The Implementation

Let's start with defining the types to represent the time bomb's status

```fsharp
type Reason =
| Exploded
| Defused

type Status =
| NotActivated
| Alive
| Dead of Reason
```

The `TimeBomb` type is going to have two internal states `reason`, to capture the `Reason` for the `Dead` status and `activated`, to store whether the time bomb is activated or not.

```fsharp
type TimeBomb () =
  // IVar<Reason>
  let reason = IVar<Reason>()
  // IVar<unit>
  let activated = IVar()
```

We are making use of the Hopac's write once variable abstraction `IVar` to define the internal states as we did in the [last blog post]({{< relref "concurrent-programming-in-fsharp-using-hopac-part-5.mmark" >}}) to model the Ticker state.


The next step is exposing the status of the time bomb.


```fsharp
type TimeBomb () =
  // ...

  // Status
  member __.Status
    with get() =
      let deadReasonAlt = // // <1>
        IVar.read reason
        |> Alt.afterFun Dead

      let activatedAlt = // // <2>
        IVar.read activated
        |> Alt.afterFun (fun _ -> Alive)

      let notActivatedAlt = // <3>
        Alt.always NotActivated

      Alt.choose [
        deadReasonAlt
        activatedAlt
        notActivatedAlt]
      |> run // <4>
```

<1> The `deadReasonAlt` will be available when the `reason` IVar is populated.

<2> The `activatedAlt` will be available when `activated` IVar is populated.

<3> The `notActivatedAlt` is the default state, that'll `always` be available. (Like a default case in a switch statement)
> ```fsharp
val always: 'x -> Alt<'x>
```
Creates an alternative that is always available and results in the given value.

<span class="callout">4</span> We are choosing between the above three `Alt`s.

Then we are going to leverage the `Ticker` component we created in the [last blog post]({{< relref "concurrent-programming-in-fsharp-using-hopac-part-5.mmark" >}}) to send the seconds remaining via `SecondsRemainingCh`.


```fsharp
type TimeBomb () =
  // ...
  let secondsRemainingCh = Ch<int>()

  // Ticker -> int -> Alt<'a>
  let rec onTick (ticker : Ticker) secondsRemaining =
    ticker.C
    |> Alt.afterJob (fun _ -> Ch.send secondsRemainingCh secondsRemaining)
    |> Alt.afterJob (fun _ -> onTick ticker (secondsRemaining - 1))

  // int -> Ticker
  let startTicker seconds =
    let ticker = new Ticker(TimeSpan.FromSeconds 1.)
    onTick ticker (seconds - 1) |> start
    ticker

  // ...

  member __.SecondsRemainingCh
    with get() = secondsRemainingCh
```

To model the explosion of the time bomb, let's define a `startTimeOut` function which takes the time bomb's actual seconds remaining during activation and uses `timeOut` function from Hopac to modify the internal state `reason` after the given delay.

```fsharp
type TimeBomb () =
  // ...

  // int -> unit
  let startTimeOut seconds =
    let timeOutAlt =
      seconds
      |> float
      |> TimeSpan.FromSeconds
      |> timeOut

    timeOutAlt
    |> Alt.afterJob (fun _ ->
        IVar.tryFill reason Exploded)
    |> start
```

Now, we have all the required functions to expose the `Activate` method. So, let's put it together.


```fsharp
type TimeBomb () =
  // ...

  // int -> Char -> unit
  let activate seconds =
    let ticker = startTicker seconds // <1>
    startTimeOut seconds // <2>
    IVar.tryFill activated () |> start // <3>
    IVar.read reason
    |> Alt.afterFun (fun _ -> ticker.Stop()) // <4>
    |> start
  // ...

  // int -> unit
  member this.Activate (seconds : int) =
    match this.Status with
    | NotActivated -> activate seconds // <5>
    | _ -> ()

  member __.DeadStatusAlt
    with get() = IVar.read reason // <6>
```

<1> Starts the ticker

<2> Starts the timer to keep track of the time to detonate the time bomb

<3> Fills the `activated` IVar to update the `Status`.

<4> Stops the `ticker`, when the time bomb is dead

<5> Activates the time bomb only if it's in `NotActivated` status.

<6> Exposes an `Alt` to communicate that the time bomb is dead.

Now it's time to simulate the time bomb explosion.

```fsharp
// TimeBomb -> unit
let printSecondsRemaining (t : TimeBomb) =
  t.SecondsRemainingCh
  |> Alt.afterFun (printfn "Seconds Remaining: %d")
  |> Job.foreverServer |> start

// unit -> unit
let simulateExplosion () =
  let seconds = 5
  let t = TimeBomb()
  t.Status |> printfn "Status: %A"
  t.Activate(seconds)
  printSecondsRemaining t
  t.Status |> printfn "Status: %A"
  t.DeadStatusAlt
  |> Alt.afterFun (printfn "Status: %A")
  |> run
```

The `simulateExplosion` function creates a `TimeBomb` with five seconds as detonation time and prints the statuses & the seconds remaining.


```bash
> simulateExplosion ();;
Status: NotActivated
Status: Alive
Seconds Remaining: 4
Seconds Remaining: 3
Seconds Remaining: 2
Seconds Remaining: 1
Seconds Remaining: 0
Status: Exploded
Real: 00:00:05.054, CPU: 00:00:00.078, GC gen0: 0, gen1: 0
val it : unit = ()
```

Awesome!

## Adding Support For Defuse

Like we see in movies, a time bomb has to have a provision to defuse! Adding this to our `TimeBomb` implementation is straightforward.

Unlike the real time bomb, instead of providing some random coloured wire to defuse the bomb, we are going to emulate this via random `char`.


```fsharp
type TimeBomb () =
  // ...

  // Ch<char>
  let inCh = Ch<char>() // <1>

  // char -> Alt<unit>
  let rec inputLoop defuseChar =
    let onInput inChar =
      if inChar = defuseChar then
        IVar.tryFill reason Defused
      else
        inputLoop defuseChar :> Job<unit>
    inCh
    |> Alt.afterJob onInput // <2>

  // ...
```

<1> Adds a new internal state `inCh`.

<2> On every input on the `inCh`, we are matching this input with the `defuseChar`. If it matches, we transition the status of the `TimeBomb` to `Dead` with the reason `Defused` else we continue the loop.


```fsharp
type TimeBomb () =
  // ...

  // char -> unit
  member this.TryDefuse(defuseChar) =
    match this.Status with
    | Alive ->
      Ch.give inCh defuseChar
      |> start
    | _ -> ()
```

Using the `TryDefuse` method, the consumer of `TimeBomb` can input the `defuseChar`, and it will be put into the `inCh` only if the `TimeBomb` is in `Alive` status.

The final step is modifying the `activate` function to support defuse.

```diff
type TimeBomb () =
  // ...

- let activate seconds =
+ let activate seconds defuseChar =
    let ticker = startTicker seconds
    startTimeOut seconds
    IVar.tryFill activated () |> start
+   inputLoop defuseChar |> start
    IVar.read reason
    |> Alt.afterFun (fun _ -> ticker.Stop())
    |> start

  // ...
- member this.Activate (seconds : int) =
+ member this.Activate (seconds : int, defuseChar : char) =
    match this.Status with
    | NotActivated ->
-     activate seconds
+     activate seconds defuseChar
    | _ -> ()
```

Alright, let's simulate the defuse and figure out whether it is working as expected!


```fsharp
let simulateDefuse char =
  let seconds = 5
  let t = TimeBomb()
  t.Status |> printfn "Status: %A"
  t.Activate(seconds, 'a')
  printSecondsRemaining t
  t.Status |> printfn "Status: %A"

  TimeSpan.FromSeconds 3. // <1>
  |> timeOut
  |> Alt.afterFun (fun _ -> t.TryDefuse(char)) // <2>
  |> Alt.afterJob (fun _ -> t.DeadStatusAlt)
  |> Alt.afterFun (printfn "Status: %A")
  |> run
```

The `simulateDefuse` function takes an input character and uses it to defuse the bomb (<2>) after a delay of three seconds (<1>).

```bash
> simulateDefuse 'a' ;;
Status: NotActivated
Status: Alive
Seconds Remaining: 4
Seconds Remaining: 3
Seconds Remaining: 2
Status: Defused
Real: 00:00:03.023, CPU: 00:00:00.026, GC gen0: 0, gen1: 0
val it : unit = ()
```

Cool, we made it :smiley:

Another simulation that we can add here is putting multiple time bombs in action. I leave it as an exercise for you!

## Summary

In this blog post, we learned how to manage to state mutation (or transition) in a concurrent program using the abstractions provided by Hopac.

The source code of this part is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.8/fsharp/HopacSeries/Part6).
