+++
title = "Using Clojure in Production"
date = 2018-09-26T11:25:01+05:30
tags = ["clojure"]

[header]
image = "clojure/blog/clj-in-prod/cover.png"
+++

We at [Ajira](https://www.ajira.tech) successfully delivered our first project in [Clojure](https://clojure.org) recently. It was an impressive outing for the last eight weeks! 

We were able to deliver some complex features with ease because of the outstanding data-oriented programming features provided by Clojure. This blog post summarizes our experiences.

## The Problem Statement

The Project that we delivered was a [Low Code Development Platform](https://en.wikipedia.org/wiki/Low-code_development_platforms) where the system administrator configures the way the entire application would look like & behave for the end user. In addition to this, the end user also can customise and create pages of his own. The platform also provides [Role Based Access Control](https://en.wikipedia.org/wiki/Role-based_access_control) which is also configurable by the system administrator. 

In a nutshell, there is no fixed domain or domain model, and configuration drives everything!

## How & Why we chose Clojure

After going through a [lean inception](https://martinfowler.com/articles/lean-inception) with the client, we found that the critical piece that we have to solve is dynamically creating the SQL queries based on some configuration and transform the shape of the returned data. 

Since the entire application is going to be dynamic and driven by configuration, we decided that a [dynamic programming language](https://en.wikipedia.org/wiki/Dynamic_programming_language) would be an ideal fit and the contenders were Javascript (Node.js) & Clojure. 

To chose the opt language, we took the dynamic SQL generation part and did a [spike](https://en.wikipedia.org/wiki/Spike_(software_development)) on both Node.js & Clojure. Within half a day, we were able to solve it with ease in Clojure and even picked another piece for the spike and completed that as well. The Node.js implementation took a day. 

Upon completion, we compared both the codebase and decided unanimously to go ahead with Clojure and got a nod from client too!

It turned out to be an excellent decision.

## Hammock Driven Development

> First, solve the problem. Then, write the code. - John Johnson

One of the significant benefits that we reaped while developing the project in Clojure was **Productivity**. Inspired by the [Hammock Driven Development](https://www.youtube.com/watch?v=f84n5oFoZBc), we took a considerable amount of time to think about the problem before jumping in to code the solution. It was a remarkable experience. As the implementation was well thought out, we were able to deliver the features [effectively](https://www.youtube.com/watch?v=2V1FtfBDsLU).

Another thing that I’d like to highlight, the process of transforming the mental model (or a whiteboard sketch) of the solution to the actual code in Clojure is astonishingly simple! No ceremony, no boilerplate and the final solution exactly resembled what we had in our mind. 


## Power of treating code as data.

[Data-Oriented Programming](https://www.infoq.com/presentations/Thinking-in-Data) is a sweet spot of Clojure, and it helped us a lot while developing the solution. 

Just by using Clojure’s [Map](https://clojure.org/reference/data_structures#Maps), [Vector](https://clojure.org/reference/data_structures#Vectors) and its core library functions we were able to achieve a lot. It also helped us seamlessly to deliver what the client wants. 

## Threading Macros 

[Threading macros](https://clojure.org/guides/threading_macros) in Clojure is another outstanding part of the core library, and it helped us a lot in achieving better code organisation and readability. 

In F#, I have used the [pipeline operator](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/operators.%5b-h%5d-%5d%5b't1,'u%5d-function-%5bfsharp%5d) to a great extent. While using it, I sometimes faced problems in defining the parameter order of functions that I am pipelining. 

A parameter order of a function `f1` that made sense in one context did not work well with pipelining in another context. So, I need to either change the parameter type or make use of the flip function to do an ephemeral swap of parameters or break the pipelining with a new intermediate binding and then continuing with a new pipelining. All these options break the elegance and readability that we get from pipelining. 

In Clojure, I never had this problem due to the `as->` macro. 

We have used `->` and `->>` macros most of the time and the `as->` macro in the places where the function's parameter order are different.  

## Destructing & Pattern Matching

Apart from the pipeline operator, the things that I enjoyed a lot while coding in F# are destructing and pattern matching. Clojure is right on the money on these features. Due to the dynamic type system and the LISP syntax, It is even more enjoyable in Clojure. 

The [clojure.match](https://github.com/clojure/core.match/wiki/Overview) library had all the bells and whistles that we needed for doing pattern matching. 

## Static Type vs Dynamic Type

I have written production systems in C#, F#, Golang & Kotlin in the last nine years and I have been using functional programming principles to develop software for the previous four years. 

This project is my first encounter with a dynamic programming language (for the backend) and LISP in production.

I was sceptic about using a dynamic programming language in production. I relied heavily on the type-safety provided by strongly typed functional programming languages like F# and used to wonder how can I build something stable without a strong type system. However, Clojure made me to revisit that thought process.  

While developing the product, I felt the freedom (from rigid types) in a lot of places & the ability to reuse the functions in different contexts was quite useful.  

I also liked the Clojure's way (Rich Hickey's way to be precise) approaching the problem solving using a dynamic programming language. The [Effective Programs talk](https://www.youtube.com/watch?v=2V1FtfBDsLU) by Rich was an eye-opener for me! 

I never felt like that I am missing the type system while working with Clojure!

## Libraries That Made Our Job Easier

#### [HoneySQL](https://github.com/jkk/honeysql#honey-sql)

As mentioned earlier, the core engine of our product has to generate a SQL query based on a configuration. The configuration data was represented using Clojure's data structures and what we wanted was a process to transform them into SQL.  [HoneySQL](https://github.com/jkk/honeysql#honey-sql) exactly does this. 

That platform had different kinds of widgets like charts, tables, add-edit forms. We made the configuration data of these widgets to specify their underlying database schema in a uniformed way and created [a single layer of abstraction](http://principles-wiki.net/principles:single_level_of_abstraction) that takes this unified representation and used HoneySQL to generate the SQL query.

The [extensibility](https://github.com/jkk/honeysql#extensibility) feature provided by HoneySQL was advantageous, and we leveraged it a lot! For example, HoneySQL does not have inherent support for `ilike` clause in Postgres. We just added an extension method with a couple of lines, and it worked like a charm.

#### [Compojure API](https://github.com/metosin/compojure-api) 

Apart from its simplicity on exposing HTTP APIs, its support for Swagger API documentation generation was very handy. We have also leveraged its [input data coercion](https://github.com/metosin/compojure-api/wiki/Coercion) ability using [Schema](https://github.com/plumatic/schema). Defining nested specs for complex domain models was a breeze due to LISP’s inherent composability

#### [Toucan](https://github.com/metabase/toucan)

We just loved this library. We had standard CRUD operations for dealing with application configuration. Developing this functionality using Toucan was an absolute breeze along with the Compojure API. 

#### Others

* Logging - [Unilog](https://github.com/pyr/unilog)
* Authentication & Authorization - [Friend](https://github.com/cemerick/friend)
* DB Migration - [Flyway](https://flywaydb.org/) & [Lein Flyway Plugin](https://github.com/metaphor/lein-flyway)
* Application Configuration - [OmniConf](https://github.com/grammarly/omniconf)
* JSON - [Cheshire](https://github.com/dakrone/cheshire)
* Database Connection Pooling - [Hikari](https://github.com/tomekw/hikari-cp)
* Amazon SES Client - [SES Mailer](https://github.com/jstaffans/ses-mailer)

## Tools

#### [VS Code Calva](https://marketplace.visualstudio.com/items?itemName=cospaia.clojure4vscode)

The creators of Calva has done an amazing work on bringing Emacs CIDER experience to VS Code. Along with the [Bracket Pair Colorizer](https://marketplace.visualstudio.com/items?itemName=CoenraadS.bracket-pair-colorizer), our development workflow went smooth.  


#### [cljfmt](https://github.com/weavejester/cljfmt) & [Eastwood](https://github.com/jonase/eastwood)

To ensure everybody in the team follows the same style & formatting of the Clojure code, we have used `cljfmt` & Eastwood in the build pipeline. 

## Summary

> The secret to building large apps is never build large apps. Break your applications into small pieces. Then, assemble those testable, bite-sized pieces into your big application - Justin Meyer

The above quote summarizes our overall experience of developing a product using Clojure. Clojure empowered us to deliver the software faster without compromising on the quality. 

It was an enlightening journey. I’d definitely consider using Clojure in my upcoming projects for sure if it is an opt fit!