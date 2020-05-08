---
title: "Configuring Database Connection Pooling, Migration and Reloaded Workflow"
date: 2019-08-06T21:59:03+05:30
tags: ["clojure"]
---

In the [last blog post]({{< relref "bootstrapping-clojure-project-using-mount-and-aero.md">}}), we bootstrapped the Clojure project using Mount and Aero. We are going to continue from we left off and configure database connection pooling, migration & Reloaded Workflow in this blog post.

> This blog post is a part 2 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).

## Configuring Hikari-CP

Let's get started by adding the [hikari-cp](https://github.com/tomekw/hikari-cp), a Clojure wrapper to [HikariCP](https://github.com/brettwooldridge/HikariCP), and the Postgres driver dependencies in the `project.clj`. 

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [org.postgresql/postgresql "42.2.6"]
                 [hikari-cp "2.8.0"]]
  ; ...
  )
```

> NOTE: If you already have a running (and jacked in) REPL, you need to stop and start it again after adding any dependencies in the `project.clj` file.

To configure the Hikari connection pool, Let's create a new file `database.clj` in the `infra` directory. 

```bash
> touch src/wheel/infra/database.clj
```

Then define a mount state `datasource` to manage the life-cycle of the connection pool.

```clojure
(ns wheel.infra.database
  (:require [wheel.infra.config :as config]
            [mount.core :as mount]
            [hikari-cp.core :as hikari]))

(defn- make-datasource []
  (hikari/make-datasource (config/database))) ;<1>

(mount/defstate datasource
  :start (make-datasource)
  :stop (hikari/close-datasource datasource))
```


<span class="callout">1</span> Retrieves the database configuration and creates the datasource object.

Now if we start the application through Mount, we will get the following output.

```clojure
wheel.infra.database=> (mount/start)
{:started ["#'wheel.infra.config/root" 
           "#'wheel.infra.database/datasource"]}
```

As the state `datasource` depends on the config's `root` state, Mount starts it first and then it starts the `datasource`. 


## Database Migration Using Flyway

There are multiple libraries in Clojure (and Java) to perform database migration. Our preference is [Flyway](https://flywaydb.org), based on our success in other Java projects. 

Let's get started by adding the dependency in the `project.clj`.

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [org.flywaydb/flyway-core "5.2.4"]]
  ; ...
  )
```

Then in the `database.clj` file, `import` the `Flyway` namespace and add a new function `migrate`

```clojure
(ns wheel.infra.database
  ; ...
  (:import [org.flywaydb.core Flyway]))

; ...

(defn migrate []
  (.. (Flyway/configure) ; <1>
      (dataSource datasource)
      (locations (into-array String ["classpath:db/migration"])) ; <2>
      load
      migrate))
```

<span class="callout">1</span> Creates an instance of Flyway and setup the configuration using the [dot special form](https://clojure.org/reference/java_interop#_the_dot_special_form)

<span class="callout">2</span> Setting the migration files path to `db/migration`.

This path doesn't exist yet. So, let's create it.

```bash
> mkdir -p resources/db/migration
```

To verify the database migration, let's load the updated `database.clj` in the REPL and invoke the `migrate` function.

```clojure
wheel.infra.database=> (mount/start)
{:started ["#'wheel.infra.config/root"
           "#'wheel.infra.database/datasource"]}
wheel.infra.database=> (migrate)
0
wheel.infra.database=> (mount/stop)
{:stopped ["#'wheel.infra.database/datasource"]}
```

If we check the database now, it will have the `flyway_schema_history` table.

```bash
> psql -d wheel

wheel=# \d

                 List of relations
 Schema |         Name          | Type  |  Owner
--------+-----------------------+-------+----------
 public | flyway_schema_history | table | postgres
(1 row)
```

## Separating Database Migration From Application Bootstrap

Performing database migration during application bootstrap has [certain limitations](https://pythonspeed.com/articles/schema-migrations-server-startup/), and it is a best practice to decouple it. In our application, we did it by having separate entry-points, one to start the application and another to migrate the database.

Let's create a new file `core.clj` in the `infra` directory.

```bash
> touch src/wheel/infra/core.clj
```

Then define two functions, `start-app` and `migrate-database`, to start the application and perform database migration, respectively. 

```clojure
(ns wheel.infra.core
  (:require [wheel.infra.config :as config]
            [wheel.infra.database :as db]
            [mount.core :as mount]))

(defn start-app []
  (mount/start))

(defn migrate-database []
  (mount/start #'config/root #'db/datasource) ; <1>
  (db/migrate) ; <2>
  (mount/stop #'db/datasource)) ; <3>
```

<span class="callout">1</span> Invokes Mount's `start` function with that states that we wanted to start. Note that Mount doesn't start the transitive dependent states in this function overload. 

<span class="callout">2</span> Performs the database migration 

<span class="callout">3</span> Stops the datasource after completing the migration.

Let's add the `stop-app` function as well to stop the application. 

```clojure
(ns wheel.infra.core
  ;...
  )
; ...
(defn stop-app []
  (mount/stop))
```

## Reloaded Workflow

[Reloaded Workflow](http://thinkrelevance.com/blog/2013/06/04/clojure-workflow-reloaded) is one of the common practice in Clojure development to do interactive REPL driven development. 

Adding this to our current codebase is straight-forward.

As a first step, add a Leiningen user profile called `dev` in the 's `project.clj` file.

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :profiles { ;...
             :dev {:source-paths ["dev"] ; <1>
                   :dependencies [[org.clojure/tools.namespace "0.3.1"]]}}) ; <2>
```

<span class="callout">1</span> Adds a new source-path to load the Clojure files from the `dev` directory.

<span class="callout">2</span> Adds a dev dependency [tools.namespace](https://github.com/clojure/tools.namespace) to reload the modified source files interactively. 

Then, create a new file `user.clj` in the `dev` directory.

```clojure
; dev/user.clj
(ns user
  (:require [wheel.infra.core :refer [start-app ; <1>
                                      stop-app 
                                      migrate-database]
                              :as infra]
            [clojure.tools.namespace.repl :as repl]))

(defn reset [] ; <2>
  (stop-app)
  (repl/refresh :after 'infra/start-app))
```
<span class="callout">1</span> Makes `start-app`, `stop-app` and `migrate-database` function to be available in the `user` namespace.

<span class="callout">2</span> Adds a `reset` function, which stops the application and reloads all the modified codes. Using the `:after` parameter, we are informing the `refresh` function to start the app after the reload.

To see it in action, stop the current REPL session and start it again. This time profile selection Calva prompt will include the `dev` profile in the list of options. 
![](/img/clojure/blog/ecom-middleware/lein-profiles-prompt.png)

When we select the `dev` profile, it will start the Leiningen REPL along with the configuration specified the `dev` profile. 

Then from the REPL, we can include the `user` profile and manage the application's life cycle.

```clojure
wheel.core=> (in-ns 'user)
#namespace[user]

wheel.core=> (start-app)
{:started ["#'wheel.infra.config/root" 
           "#'wheel.infra.database/datasource"]}

wheel.core=> (stop-app)
{:stopped ["#'wheel.infra.database/datasource"]}

wheel.core=> (migrate-database)
{:stopped ["#'wheel.infra.database/datasource"]}

wheel.core=> (reset)
:reloading (wheel.infra.config wheel.infra.database 
            wheel.infra.core wheel.core wheel.core-test user)
{:started ["#'wheel.infra.config/root" 
           "#'wheel.infra.database/datasource"]}
```

## Summary

In this blog post, we learnt how to configure the database connection pooling using Hikari, database migration using Flyway and Reloaded Workflow using the Mount and Leiningen profile. There are other libraries and ways to do this as well, but the approach that I described here is the one that worked for us. 

I would love to learn your preferences and approaches. 

The source code associated with this part is available on [this GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.14/clojure/wheel) repository. 