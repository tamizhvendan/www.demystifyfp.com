---
title: "Concurrent Programming in fsharp using Hopac (Part-I)"
date: 2018-02-26T19:08:32+05:30
tags : ["fsharp", "Hopac", "concurrent-programming"]
---

Enabling developers to write concise code in solving complex problems is one of the significant characteristics of functional programming. The conciseness is mostly due to the abstractions provided by the functional programming language.

Can we apply these abstractions and write concurrent programs with ease?

We are going to find the answer to this question by writing concurrent programs in fsharp using the [Hopac](https://github.com/Hopac/Hopac) library.


## What is Hopac

Hopac is a fsharp library that provides a programming model inspired by John Reppy's [Concurrent ML](https://en.wikipedia.org/wiki/Concurrent_ML) language. Other languages that offer similar or related models include Racket, Clojure core.async, and Go.

> The essence of Hopac is lightweight threads, called jobs, and flexible lightweight synchronous message passing via channels (and other messaging primitives) - [Hopac Programming model](https://github.com/Hopac/Hopac/blob/master/Docs/Programming.md#the-hopac-programming-model)


## Development Setup

We are going to make use of fsharp script file in this blog post to explore Hopac.

As a first step, initialise [paket](https://fsprojects.github.io/Paket/) either [manually](https://fsprojects.github.io/Paket/getting-started.html#Manual-setup) or using [forge](http://forge.run/), which automates the manual setup.

```bash
> forge paket init
```

Then add the Hopac library using paket.

```bash
> paket add Hopac
```

After installing, create a fsharp script file and refer the Hopac library

```fsharp
#r "packages/Hopac/lib/net45/Hopac.Core.dll"
#r "packages/Hopac/lib/net45/Hopac.Platform.dll"
#r "packages/Hopac/lib/net45/Hopac.dll"

open Hopac
```

## The "Hello World" Job

The type [Job](http://hopac.github.io/Hopac/Hopac.html#def:type%20Hopac.Job) is the core programming model of Hopac that represents a lightweight thread of execution.

We can create `Job<'x>` in Hopac by using its [JobBuilder](http://hopac.github.io/Hopac/Hopac.html#def:type%20Hopac.JobBuilder) aka `job` computation expression.


```fsharp
let helloWorldJob = job {
  printfn "Hello, World!"
}
```

We can then run this job using the [run](http://hopac.github.io/Hopac/Hopac.html#def:val%20Hopac.Hopac.run) function.

```fsharp
run helloWorldJob
```

Executing the above code in F# Interactive will produce the following output

```bash
> run helloWorldJob;;
Hello, World!
val it : unit = ()
```

> The `run` function starts running the given job and then blocks the current thread waiting for the job to either return successfully or fail. `run` is mainly provided for conveniently running Hopac code from F# Interactive and can also be used as an entry point to the Hopac runtime in console applications. - Hopac Documentation.

## A Time Consuming Job

Now we know how to create and run jobs in Hopac. As a next step, let's define a `job` that takes some time for its computation.

We are going to simulate this delay by using the `timeOutInMillis` function from Hopac that delays the computation for the provided milliseconds.

```fsharp
let longerHelloWorldJob = job {
  do! timeOutMillis 2000
  printfn "Hello, World!"
}
```

If we run this new job with the F# Interactive timer on, we can see that the execution of this function takes two seconds (or 2000 milliseconds).


```fsharp
#time "on"
run longerHelloWorldJob
#time "off"
```

```bash
--> Timing now on

Hello, World!
Real: 00:00:02.003, CPU: 00:00:00.006, GC gen0: 0, gen1: 0
val it : unit = ()


--> Timing now off
```

## Running Concurrent Jobs

To run multiple jobs concurrently, we first need multiple jobs. So, let's create a new function `createJob` that takes a job id (to differentiate the jobs) and the job's computation time as its parameters and return the newly created `job`.

```fsharp
// int -> int -> Job<unit>
let createJob jobId delayInMillis  = job {
  printfn "starting job:%d" jobId
  do! timeOutMillis delayInMillis
  printfn "completed job:%d" jobId
}
```

With the help of this `createJob` function, we can create multiple jobs with different computation time.

```fsharp
// Job<unit> list
let jobs = [
  createJob 1 4000
  createJob 2 3000
  createJob 3 2000
]
```

If we run these job sequentially, it will take nine seconds (9000 milliseconds) to complete. To make it run concurrently and complete the execution in four seconds (4000 milliseconds), we can leverage the [conIgnore](http://hopac.github.io/Hopac/Hopac.html#def:val%20Hopac.Job.conIgnore) function from Hopac

> The `conIgnore` function creates a job that runs all of the jobs as separate concurrent jobs and then waits for all of the jobs to finish. The results of the jobs are ignored.


```fsharp
// Job<unit>
let concurrentJobs = Job.conIgnore jobs
```

Let's verify this concurrent behaviour


```fsharp
#time "on"
run concurrentJobs
#time "off"
```

```bash
--> Timing now on

starting job:3
starting job:1
starting job:2
completed job:3
completed job:2
completed job:1
Real: 00:00:04.007, CPU: 00:00:00.013, GC gen0: 0, gen1: 0
val it : unit = ()


--> Timing now off
```

Awesome! We just witnessed the power of Hopac for the very first time and saved five seconds in execution!


## A Real World Example

As the last example of this blog post, let's have a look at a modified real-world use case from my previous project.

Let's assume that we are building a home page of a product in an e-commerce portal which displays the product along with its reviews. The product details are stored in a database, and the reviews of the product are stored in an external system. The requirement is to write an API that pulls the data from the both these sources, merge it and send it back to the client.

If we model this use case using Hopac Jobs, we would have a function to retrieve the product from the database.

```fsharp
type Product = {
  Id : int
  Name : string
}

// int -> Job<Product>
let getProduct id = job {

  // Delay in the place of DB query logic for brevity
  do! timeOutMillis 2000

  return {Id = id; Name = "My Awesome Product"}
}
```

Another function to retrieve the product reviews from an external system

```fsharp
type Review = {
  ProductId : int
  Author : string
  Comment : string
}

// int -> Job<Review list>
let getProductReviews id = job {

  // Delay in the place of an external HTTP API call
  do! timeOutMillis 3000

  return [
    {ProductId = id; Author = "John"; Comment = "It's awesome!"}
    {ProductId = id; Author = "Sam"; Comment = "Great product"}
  ]
}
```

The final piece is writing another function that merges the results from these two functions. Like the `async` computation expression in fsharp, in the `job` computation expression, we can use the `let!` binding to retrieve the output (or result) of a job.


```fsharp
type ProductWithReviews = {
  Id : int
  Name : string
  Reviews : (string * string) list
}

// int -> Job<ProductWithReviews>
let getProductWithReviews id = job {
  let! product = getProduct id // <1>
  let! reviews = getProductReviews id // <2>
  return {  // <3>
    Id = id
    Name = product.Name
    Reviews = reviews |> List.map (fun r -> r.Author,r.Comment)
  }
}
```

<1> retrieves `Product` from the `Job<Product>`

<2> retrieves `Review list` from the `Job<Review list>`

<3> return the merged result `ProductWithReviews`

Let's execute this snippet in F# Interactive to verify the outcome


```fsharp
#time "on"
getProductWithReviews 1 |> run
#time "off"
```

```bash
--> Timing now on

Real: 00:00:05.008, CPU: 00:00:00.009, GC gen0: 0, gen1: 0

val it : ProductWithReviews =
  {Id = 1;
   Name = "My Awesome Product";
   Reviews = [("John", "It's awesome!"); ("Sam", "Great product")];}


--> Timing now off
```

The output is as expected but the time it took is five seconds (two to retrieve the product and three to retrive the reviews). It is because of the sequential execution of the jobs

Can we make it fast by running them parallelly?

As these two function calls are independent of each other, we can run them parallelly and then merge the results.

To do it, we are going to leverage the infix operator `<*>` from Hopac

```fsharp
val ( <*> ): Job<'x> -> Job<'y> -> Job<'x * 'y>
```

> The infix operator `<*>` creates a job that runs the given jobs as two separate parallel jobs and returns a pair of their results.

```fsharp
open Hopac.Infixes

let getProductWithReviews2 id = job {
  let! product, reviews =
    getProduct id <*> getProductReviews id
  return {
    Id = id
    Name = product.Name
    Reviews = reviews |> List.map (fun r -> r.Author,r.Comment)
  }
}
```

If we execute this new function

```fsharp
#time "on"
getProductWithReviews2 1 |> run
#time "off"
```

we will get the same output now in three seconds instead of five.

```bash
--> Timing now on

Real: 00:00:03.005, CPU: 00:00:00.008, GC gen0: 0, gen1: 0
val it : ProductWithReviews =
  {Id = 1;
   Name = "My Awesome Product";
   Reviews = [("John", "It's awesome!"); ("Sam", "Great product")];}


--> Timing now off
```

## Summary

One of the well-thought aspects of Hopac library is its `job` computation expression and its  similarity with the `async` computation expression makes it easier to learn and apply!

We had only scratched the surface of the Hopac library in this blog post. Hopac library has a lot of powerful abstractions in its arsenal which we will see in action in the upcoming blog posts.

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.2/fsharp/HopacSeries/Part1)
