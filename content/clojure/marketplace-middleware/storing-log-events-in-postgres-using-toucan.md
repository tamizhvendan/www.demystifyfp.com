---
title: "Storing Log Events in Postgres Using Toucan"
date: 2019-10-04T17:55:02+05:30
tags: ["clojure", "Toucan", "Timbre"]
---

In the last blog post, we configured Timbre to log the events in the Console. In this blog post, we are going to add a database appender to persist the domain level events alone in Postgres using [Toucan](https://github.com/metabase/toucan).

> This blog post is a part 4 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).

### Adding Migration Script

Let's get started by adding the migration script to create the `event` table in the database.

```batch
> mkdir -p resources/db/migration
> touch resources/db/migration/V201910021105__create_event.sql
```

```sql
-- V201910021105__create_event.sql
CREATE TYPE event_level AS ENUM (
  'info', 'debug',
  'error', 'warn',
  'fatal');

CREATE TYPE channel_name AS ENUM (
  'tata-cliq', 'amazon', 'flipkart');

CREATE TABLE event (
  id UUID PRIMARY KEY,
  parent_id UUID REFERENCES event(id),
  level event_level NOT NULL,
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name channel_name NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);
```

As we [already configured]({{<relref "configuring-database-connection-pooling-migration-reloaded-workflow.md#database-migration-using-flyway">}}) flyway to use the `db/migration` directory for the migration files, we can invoke the `migrate-database` function in the *infra/core.clj* in the REPL to migrate the database.

```bash
wheel.infra.core=> (migrate-database)
{:stopped ["#'wheel.infra.database/datasource"]}
```

After the successful database migration, we can see the `event` table in the `wheel` database. 

```bash
> psql -d wheel
wheel=# \d event
                Table "public.event"
    Column    |           Type           | Nullable |
--------------+--------------------------+----------+
 id           | uuid                     | not null |
 parent_id    | uuid                     |          |
 level        | event_level              | not null |
 name         | text                     | not null |
 channel_id   | text                     | not null |
 channel_name | channel_name             | not null |
 timestamp    | timestamp with time zone | not null |
# ...
```

### Configuring Toucan

[Toucan](https://github.com/metabase/toucan) is a light-weight ORM library. It provides the better parts of an ORM for Clojure. Let's add this dependency in our *project.clj* and restart the REPL to make it a part of our project.

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [toucan "1.14.0"]]
  ; ...
  )
```

To use Toucan to interact with the database, we need to set two of its settings. The `datasource` it has to use and the namespace it has to look for the application model definitions.

As we need to do this only once in the application' life cycle, let's define a new Mount state `toucan` to configure these settings.

```clojure
; src/wheel/infra/database.clj
(ns wheel.infra.database
  (:require ; ...
            [toucan.db :as db]
            [toucan.models :as models])
  ; ...
  )
; ...
(defn- configure-toucan []
  (db/set-default-db-connection! {:datasource datasource}) ; <1>
  (models/set-root-namespace! 'wheel.model)) ; <2>

(mount/defstate toucan
  :start (configure-toucan))
```

Then we need to add the model definition for the `event` table.

```bash
> mkdir src/wheel/model
> touch src/wheel/model/event.clj
```

```clojure
; src/wheel/model/event.clj
(ns wheel.model.event
  (:require [toucan.models :as models]))

(models/defmodel Event :event
  models/IModel
  (types [_]
         {:name :keyword
          :channel-name :channel-name
          :level :event-level}))
```

Toucan supports Clojure keywords out of the box for the column values, and all we need to do is specify the column type as `:keyword`. It internally takes care of converting the keyword to string and vice-versa.

The `channel_name` and the `level` are enums in PostgreSQL and Toucan doesn't know how to convert them. To make it work with enums, we defined the event model with these column having the type `:channel-name` and `:event-level` respectively.

Then in the `configure-toucan` function, we need to define the `in` and `out` functions for these types.

```clojure
; src/wheel/infra/database.clj
(ns wheel.infra.database
  ; ...
  (:import ; ...
           [org.postgresql.util PGobject]))

; ...
(defn- pg-object-fn [pg-type]
  (fn [value]
    (doto (PGobject.)
      (.setType pg-type)
      (.setValue (name value)))))

(defn- configure-toucan []
  ; ... 
  (models/add-type! :event-level
                    :in (pg-object-fn "event_level")
                    :out keyword)
  (models/add-type! :channel-name
                    :in (pg-object-fn "channel_name")
                    :out keyword))
; ...
```

During database writes, Toucan uses the function passed `:in` parameter to convert the value into the corresponding `PGobject` and the `:out` function to convert the value from the database to a Clojure keyword.

We are using **kebab-case** naming convention for the column names, but in Postgres, we are using **snake_case** convention. We can let the Toucan take care of this conversion by configuring it like this.

```clojure
(defn- configure-toucan []
  ; ...
  (db/set-default-automatically-convert-dashes-and-underscores! true))
```

With this, the configuration side of Toucan is done and let's add a function to persist an event in the database.

```clojure
; src/wheel/model/event.clj
(ns wheel.model.event
  (:require ; ...
            [clojure.spec.alpha :as s]
            [toucan.db :as db]
            [wheel.middleware.event :as event])
  (:import [java.time OffsetDateTime]
           [java.time.format DateTimeFormatter]))
; ...

(defn- timestamp->offset-date-time [timestamp]
  (OffsetDateTime/parse timestamp DateTimeFormatter/ISO_OFFSET_DATE_TIME))

(defn create! [new-event]
  {:pre [(s/assert ::event/event new-event)
         (s/assert event/domain? new-event)]}
  (as-> new-event evt
    (update evt :timestamp timestamp->offset-date-time)
    (dissoc evt :type)
    (db/insert! Event evt)))
```

Like the `write!` function in the `log.clj`, the `create!` function is one of the application boundaries where we take an event and save it to the database.

> In the actual project that we developed, We made it a practice to have spec asserts in all the public functions at the application boundaries.

Here we have two asserts, one to check whether the incoming data is an `event` or not and another one to check whether it is a domain event as we will be storing only domain events in the database.

This `domain?` function is not defined yet, so let's add it.

```clojure
; src/wheel/middleware/event.clj
; ...
(defn domain? [event]
  (and (s/valid? ::event event)
       (= :domain (:type event))))
```

If we load all these changes in the REPL and execute the following expression, we should be able to see the new event in the database.

```clojure
wheel.model.event=> (create! {:name :ranging/succeeded
                              :type :domain
                              :channel-id "UA"
                              :level :info
                              :timestamp "2019-10-01T12:30+05:30"
                              :id (java.util.UUID/randomUUID)
                              :channel-name :tata-cliq})
#wheel.model.event.EventInstance
{:channel-id "UA",
 :channel-name :tata-cliq,
 :id #uuid "1866be97-9a8d-4e96-b1a4-b700a9b6ff25",
 :level :info,
 :name :ranging/succeeded,
 :parent-id nil,
 :timestamp #inst "2019-10-01T07:00:00.000-00:00"}
```

![](/img/clojure/blog/ecom-middleware/first-event-in-pg.png)

Let's turn our attention to the Timbre side and a database appender to using this `create!` function to store the log entry (event).

### Adding Database Appender

Create a new directory *log_appender* under *infra* and a new file *database.clj*.

```bash
> mkdir src/wheel/infra/log_appender
> touch src/wheel/infra/log_appender/database.clj
```

Then add a function that takes the message from the log and create the event using the `create!` function that we just defined. 

```clojure
; src/wheel/infra/log_appender/database.clj
(ns wheel.infra.log-appender.database
  (:require [wheel.model.event :as event]))

(defn- append-to-db [{:keys [msg_]}]
  (let [evnt (read-string (force msg_))]
    (when (= :domain (:type evnt))
      (event/create! evnt))))
```

> Note: We are only storing the event's of type `:domain`.

An appender in [Timbre](https://github.com/ptaoussanis/timbre#configuration) is a map, and our database appender would look like this.

```clojure
; src/wheel/infra/log_appender/database.clj
; ...
(def appender {:enabled? true
               :output-fn :inherit
               :async? true
               :fn append-to-db})
```

The `:fn` key specifies the side-effect, appending to the database, and we are setting the `:async?` flag to true to perform the logging asynchronously. 

The last step is to configure Timbre to use this appender.

```clojure
; src/wheel/infra/log.clj
(ns wheel.infra.log
  (:require ; ...
            [wheel.infra.log-appender.database :as database]))

; ...

(defn init []
  (timbre/merge-config! {; ...
                         :appenders {:database database/appender}}))
; ...
```

After loading these changes in REPL, if we try to log using the `write!` we can see that the new event getting stored in the database as expected.

```clojure
wheel.infra.log=> (init)
{:level :debug
 ; ... ignored for brevity
}
wheel.infra.log=> (write! {:name :deranging/succeeded
                           :type :domain
                           :level :info
                           :channel-id "UB"
                           :timestamp "2019-10-04T15:56+05:30"
                           :id (java.util.UUID/randomUUID)
                           :channel-name :tata-cliq})
{"name":"deranging/succeeded","type":"domain", ... }
nil
```

![](/img/clojure/blog/ecom-middleware/second-event-in-pg.png)


## Summary

In this blog post, we implemented the PostgreSQL appender for Timbre to persist the domain events in the database. In this process, we learnt how to configure Toucan to work with Postgres enum types, how to leverage clojure.spec in the application boundaries. In the next blog post, we will be adding an appender to send messages on Slack in case of any errors.

The source code associated with this part is available on [this GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.15/clojure/wheel) repository.