---
title: "Bootstrapping Clojure Project Using Mount And Aero"
date: 2019-07-26T15:39:03+05:30
tags: ["clojure"]
---

In this blog post, we are going to focus on bootstrapping the Clojure project using [Mount](https://github.com/tolitius/mount) & [Aero](https://github.com/juxt/aero) and interacting with the application using the REPL.


> This blog post is a part 1 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).


## Getting Started

Let's get started by creating a new `app` project using [Leiningen](https://github.com/technomancy/leiningen) and give it a project name `wheel`. 

```bash
lein new app wheel
```

## Reading Configuration

To manage the application-level configuration, we are going to use [Aero](https://github.com/juxt/aero). 

```clojure
; project.clj
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [[org.clojure/clojure "1.10.1"]
                 [aero "1.1.3"]]
  ; ...
  )
```

Aero expects us to specify the configuration as a Clojure `map` in an `EDN` file. So, let's create a `config.edn` in the `resources` directory and add configuration map with the database configuration entry.

```clojure
{:app
 {:database
  {:adapter            "postgresql"
   :username           #or [#env "WHEEL_APP_DB_USERNAME" "postgres"]
   :password           #or [#env "WHEEL_APP_DB_PASSWORD" "postgres"]
   :database-name      #or [#env "WHEEL_APP_DB_NAME" "wheel"]
   :server-name        #or [#env "WHEEL_APP_DB_SERVER" "localhost"]
   :port-number        #or [#env "WHEEL_APP_DB_PORT" 5432]}}}
```

When Aero reads this map, it tries to populate the configuration parameters from the environment variables and use the defaults if the corresponding environment variable not found. 

To read this configuration in our application, Let's add a new file `config.clj` under a folder `infra`. 

```bash
> mkdir src/wheel/infra
> touch src/wheel/infra/config.clj
```

Then add a new function to read this configuration.

```clojure
; infra/config.clj
(ns wheel.infra.config
  (:require [aero.core :as aero]
            [clojure.java.io :as io]))

(defn- read-config []
  (aero/read-config (io/resource "config.edn")))
```

Now we need to read this configuration during the application bootstrap before starting anything else. It's where [Mount](https://github.com/tolitius/mount) comes into the picture. 

```clojure
; project.clj
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [ ; ...
                 [mount "0.1.16"]]
  ; ...
  )
```

With Mount added as dependency, let's define a Mount state called `root` 

```clojure
; infra/config.clj
(ns wheel.infra.config
  (:require ; ...
            [mount.core :as mount]))

(defn- read-config []
  (aero/read-config (io/resource "config.edn")))

(mount/defstate root
  :start (read-config))
```

Then add a new function `database` to expose the database configuration, 

```clojure
; infra/config.clj
; ...
(defn database []
  (get-in root [:app :database]))
```

By defining an individual function(s) like this for each sub-system configuration, we are decoupling the implementation of the configuration from the downstream parts of the system which require this configuration. 

## Verifying using REPL

To verify our implementation so far, let's start the REPL

```bash
> lein repl
```

Inside the REPL, load and switch to the `wheel.infra.config` namespace

```bash
wheel.core=> (load "wheel/infra/config")
nil
wheel.core=> (in-ns 'wheel.infra.config)
#object[clojure.lang.Namespace 0x7d26cd65 "wheel.infra.config"]
```

Then start Mount, which will in-turn start the `config/root` state.

```bash
wheel.infra.config=> (mount/start)
{:started ["#'wheel.infra.config/root"]}
```

Now we can call the `database` function to get the database configuration.

```bash
wheel.infra.config=> (database)
{:adapter "postgresql", :username "postgres", ...}
```

This approach is one of the least effective ways to interact with the REPL without any editor/IDE support. 

Let's have a look at how do we do it in VS Code.

## VS Code Calva-REPL

The VS Code [Calva Extension](https://marketplace.visualstudio.com/items?itemName=betterthantomorrow.calva) provides a very good development experience for developing Clojure applications in VS Code. 

To use the REPL in VS Code, open the project and issue the command `Calva: Start a REPL project and connect` (`ctrl+alt+c ctrl+alt+j`).

In the project type prompt, select `Leiningen` and then in the profiles prompt, select none. 

When Calva has connected, it will open a REPL window. 

Then open the `config.clj` file and issue the command `Calva: Load (evaluate) current file and its dependencies` (`ctrl+alt+c enter`). It will load the `wheel.infra.config` namespace in the REPL.

We can type in the code as we did in the previous section. However, typing directly in the REPL is not a recommended practice. Usually, we will use the [comment](https://clojuredocs.org/clojure.core/comment) special form and type in the individual expressions that we want to explore in the REPL. 

```clojure
; config.clj
; ...
(comment 
  (mount/start)
  (database))
```

To verify the output, place the cursor at the end of `(mount/start)` and issue the command `Calva: Send Current Form to REPL wind and evaluate it` (`alt+ctrl+c  alt+e`). We will get output like below in the REPL window. 

```bash
wheel.infra.config=> (mount/start)
{:started ["#'wheel.infra.config/root"]}
```

We can do a similar thing to verify the `database` function.

```bash
wheel.infra.config=> (database)
{:adapter "postgresql", :username "postgres", ...}
```

We can stop the application by calling the mount's `stop` function.

```clojure
; config.clj
; ...
(comment 
  (mount/stop))
```

## Summary

In this blog post, we created a new Clojure project using Leiningen, added the application-level configuration using Aero and bootstrapped the configuration reading part using Mount. We also learnt how to interact with the application using the REPL.

The source code is available on [this GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.13/clojure/wheel) repository. 