---
title: "Concurrent Programming in Fsharp Using Hopac (Part-2)"
date: 2018-02-28T19:47:02+05:30
tags : ["fsharp", "Hopac", "concurrent-programming"]
type: "post"
reading_time: true
---

In the [last blog post]({{<relref "concurrent-programming-in-fsharp-using-hopac-part-1.mmark">}}), we learned the how to create jobs and run them parallelly using [Hopac](https://github.com/hopac/Hopac). In this second part of the blog post series, we are going to explore inter-job communication.

## Share Memory By Communicating

In multi-threaded programming model, if two threads want to communicate, the typical approach is using a shared memory backed by locks, thread-safe data structures (or other synchronisation primitives). We have to follow specific [best practices](https://docs.microsoft.com/en-us/dotnet/standard/threading/managed-threading-best-practices) to avoid Deadlocks and Race Conditions while using the shared memory approach. Failing to do so may result in unpredictable behaviour of the system that is hard to debug. It potentially ends up as a maintenance nightmare.

The Hopac programming model provides an alternative approach for structuring inter-job (aka lightweight thread) communication. It emphasises on passing the data through synchronous communication channels between jobs instead of mediating the access to shared data.

To understand this better, let's see it in action.


## Revisiting Running Concurrent Jobs example

In the [part-1]({{< relref "concurrent-programming-in-fsharp-using-hopac-part-1.mmark#running-concurrent-jobs">}}), we learned how to run mutliple jobs concurrently.


```fsharp
// int -> int -> Job<unit>
let createJob jobId delayInMillis = job {
  printfn "starting job:%d" jobId // <1>
  do! timeOutMillis delayInMillis // <2>
  printfn "completed job:%d" jobId // <3>
}

// Job<unit> list
let jobs = [
  createJob 1 4000
  createJob 2 3000
  createJob 3 2000
]

let concurrentJobs = Job.conIgnore jobs

run concurrentJobs
```

The `job` created by the `createJob` function does two things.

<1> & // <3> - prints the status of the job

<2> - perform the actual computation (simulated using delay)

In other words, it communicates its status to the external world by printing on the console in addition to performing its computation.

Let's assume that there is a new requirement, where we need to send the status in a message queue instead of printing it?

We need to decouple the `job` from performing the console output and enable it to communicate its status through some abstraction.


## The Ch<'x> Type

The `Ch<'x>` type is an abstraction provided by Hopac to communicate between jobs. In the next section, we are going to make use of this type to decouple the responsibilities of the job that we just saw.

> Channel represents a synchronous channel and provide a simple rendezvous mechanism for concurrent jobs and are designed to be used as the building blocks of selective synchronous abstractions.

> Channels are lightweight objects and it is common to allocate fresh channels for short-term, possibly even one-shot, communications.

> Channels are optimized for synchronous message passing, which can often be done without buffering. Channels also provide an asynchronous Ch.send operation, but in situations where buffering is needed, some other message passing mechanism such as a bounded mailbox, `BoundedMb<_>`, or unbounded mailbox, `Mailbox<_>`, may be preferable. - [Hopac Documentation](https://hopac.github.io/Hopac/Hopac.html#def:type%20Hopac.Ch)



## A Communicating Job In Action

```fsharp
val give: Ch<'x> -> 'x -> Alt<unit>
```

The `give` function in the `Ch` module, give the given value on the given channel and return the control when another job takes the value provided.

> The return type `Alt<unit>` is a sub class of `Job<unit>`. We are going to explore this in detail in an another blog post. For now, you can assume it as a `Job<unit>`

To make use of this function, we first need to define the data type `'x`. In our case, it is the `JobStatus`

```fsharp
type JobStatus =
| Started of jobId : int
| Completed of jobId : int
```

Then refactor the `createJob` function as below


```fsharp
// Ch<JobStatus> -> int -> Job<unit>
let createJob jobStatusChannel jobId = job {
  do! Ch.give jobStatusChannel (Started jobId) // <1>
  do! timeOutMillis (jobId * 1000) // <2>
  do! Ch.give jobStatusChannel (Completed jobId) // <3>
}
```

<1> & // <3> - Communicate the job status through channels instead of printing

<2> - Simulates a long computation. (Job id `1` takes one second, `2` takes two seconds and so on)

To take the data from a channel, Hopac provides `take` function

```fsharp
val take: Ch<'x> -> Alt<'x>
```
> Creates an alternative that, at instantiation time, offers to give the given value on the given channel, and becomes available when another job offers to take the value.

Our next step is creating another `job` which makes use of this function to take the value from the `Ch<JobStatus>` and prints the status to the console.


```fsharp
// Ch<JobStatus> -> Job<unit>
let jobStatusPrinterJob jobStatusChannel = job {
  let! jobStatus = Ch.take jobStatusChannel // <1>
  match jobStatus with
  | Started jobId ->
    printfn "starting job:%d" jobId
  | Completed jobId ->
    printfn "completed job:%d" jobId
}
```

<1> - Waits for the `JobStatus` to be available in the `Ch<JobStatus>` and takes it when it is available.

Note that the `jobStatusPrinterJob` doesn't wait for the next value in the channel.

The final step is wire up jobs that we created so far.


```fsharp
// Ch<JobStatus> -> int -> Job<unit>
let main jobStatusChannel jobsCount = job {
  let jobStatusPrinter = jobStatusPrinterJob jobStatusChannel // <1>
  do! Job.foreverServer jobStatusPrinter // <2>
  let myJobs = List.init jobsCount (createJob jobStatusChannel) // <3>
  return! Job.conIgnore myJobs // <4>
}
```

<1> - Initializes the `jobStatusPrinter` job.

<2> - Makes use of the [foreverServer](https://hopac.github.io/Hopac/Hopac.html#def:val%20Hopac.Job.foreverServer) function from Hopac which creates a job that starts a separate server job that repeats the `jobStatusPrinter` job indefinitely.

<3> - Creates a list of jobs for the given `jobsCount`

<4> Uses the [conIgnore](https://hopac.github.io/Hopac/Hopac.html#def:val%20Hopac.Job.conIgnore) function to creates a job that runs all of the jobs as separate concurrent jobs and then waits for all of the jobs to finish

To run this `main` job, we need a `Ch<JobStatus>`. We can create it using the constructor of the `Ch<'x>` type.

```fsharp
let jobStatusChannel = Ch<JobStatus>()
let jobsCount =  5

#time "on"
main jobStatusChannel jobsCount |> run
#time "off"
```

Executing the above code snippet in F# interactive will produce the final output

```bash
--> Timing now on

starting job:2
starting job:1
starting job:0
starting job:4
starting job:3
completed job:0
completed job:1
completed job:2
completed job:3
completed job:4
Real: 00:00:04.002, CPU: 00:00:00.013, GC gen0: 0, gen1: 0
val it : unit = ()

--> Timing now off
```

From the output, we can verify that the all the jobs were executed parallelly and we have decoupled the communication part!


## Summary

In this blog post, we have seen the Hopac channels in action using a trivial example. In the upcoming blog posts, we'll be learning some more advanced abstractions provided by Hopac.

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.3/fsharp/HopacSeries/Part2)
