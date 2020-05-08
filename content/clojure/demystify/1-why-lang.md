---
title: "Why should I learn another programming language?"
date: 2019-07-05T14:35:45+05:30
draft: true
tags: ["Clojure"]
---

> This blog post is the part 1 of the blog series [Demystifying Clojure]({{<relref "toc.md">}})

## The Mindset

As software developers, what we do in our day-to-day work?

Almost all the stuff that we work on start with a problem statement and our objective is to provide a solution to it.

Let's assume that the problem and the solution are two geo-coordinates in a map and our objective is to travel from problem to solution. We can choose any vehicle that makes sense in the context of the journey and travel towards the destination.
![](/img/clojure/blog/demystify/why-lang/why-fp-vehicle.png)

The vehicle we choose, **influence the experiences** of our journey.

If we are travelling by bicycle, we are not going to bother about the fuel prices. If we are travelling by car, we are not going to experience turbulence. If we are travelling by flight, the road condition doesn't matter.

Back to our problem to solution journey example, the programming language that we choose is just a vehicle. Like vehicle influences the journey, The programming language we choose influences our thought process and approach to arrive at a solution.

![](/img/clojure/blog/demystify/why-lang/why-fp-langs.png)

Let me show you an example to experience this.

Here is a small code snippet in "C" that computes the square values of an array of integers.

```c
int numbers[3] = {2,3,4}, squaredNumbers[3];
for (int i = 0; i < 3; i++) {
  squaredNumbers[i] = numbers[i] * numbers[i];
}
```

Here, in the `for` loop, we need to specify the lower and the upper bound of the array length that we are operating on. Most of us got it wrong in our early days (or even few days ago)!

Let's have a look at a `Clojure` code snippet which does the same thing.

```clojure
(let [numbers [2 3 4]]
  (mapv (fn[n] (* n n)) numbers))
```

What happened to our for loop and where is the tussle with the array bounds?

We are experiencing a different thing here as we are using a different programming language (a different programming paradigm to be precise).

> "A language that doesn't affect the way you think about programming, is not worth knowing." - **Alan Perlis**

There is nothing wrong with any programming languages and each exists for a reason. Just like nothing wrong with the vehicle that we choose for our journey, it's all depends what do we want to get out of it. 

`Clojure` is a different programming language(vehicle) which provides a different set of benefits and experiences.


## Knowledge Portfolio

> "Invest regulary in your knowledge portfolio. Learn at least one new language every year. Different languages solve the same problems in different ways. By learning several different approaches, you can help broaden your thinking and avoid getting stuck in a rut."  - **Pragmatic Programmer**

The concept of "Knowledge Portfolio" from the Pragmatic Programmer book made a significant impact in my career. 

* `C` and `Java` kickstarted my programming journey.
* `C#` helped me to get better at Object Oriented Programming. 
* `javascript` made me a full-stack developer.
* `Haskell` introduced me to a whole new world of functional programming. 
* `F#` enabled me to apply functional programming in real world applications.
* `Golang` taught me how to write maintainable concurrent programs.
* `Kotlin` empowered me to do functional programming in Android applications. 

I believe you would also have a list like this and your takeaways may be same or different!

In my knowledge porfolio, `Clojure`, functional dialect of the LISP language, enlighted me the simplicity and the data-driven side of programming. It is the joy that I had while writing it made me to write this series of blog posts to spread the happiness. 

> "Lisp is worth learning for the profound enlightenment experience you will have when you finally get it; that experience will make you a better programmer for the rest of your days, even if you never actually use Lisp itself a lot." - **Eric Raymond, "How to Become a Hacker"**