---
title: "Configuring Logging Using Timbre"
date: 2019-10-02T05:50:01+05:30
tags: ["clojure", "Timbre"]
---

In the first two blog posts of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}), we learnt how to bootstrap a Clojure project using [Mount](https://github.com/tolitius/mount) & [Aero](https://github.com/juxt/aero) and how to configure database connection pooling & database migration along with reloaded workflow. We are going to continue setting up the infrastructure, and in this blog post, we are going to take up logging using [Timbre](https://github.com/ptaoussanis/timbre). 

Timbre is a Clojure/Script logging library that enables to configure logging using a simple Clojure map. If you ever had a hard time dealing with complex (XML based) configuration setup for logging, you will feel a breath of fresh air while using Timbre. Let's dive in!

> This blog post is a part 3 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).


## Timbre 101

To get started, let's add the dependency in the *project.clj* and restart the REPL to download and include the dependency in our project. 

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [com.taoensso/timbre "4.10.0"]]
  ; ...
  )
```

Then create a new file `log.clj` and refer the `timbre` library.

```bash
> touch src/wheel/infra/log.clj
```

```clojure
(ns wheel.infra.log
  (:require [taoensso.timbre :as timbre]))
```

To play with the functionality provided by Timbre, send the above snippet to the REPL and then use any of the `info`, `warn`, `debug` or `error` macro to perform the logging. By default, Timbre uses `println` to write the logs in the console.

```clojure
wheel.infra.log=> (timbre/info "Hello Timbre!")
19-09-29 04:59:03 UnknownHost INFO [wheel.infra.log:1] - Hello Timbre!
nil
```

These macros also accept Clojure maps.

```clojure
wheel.infra.log=> (timbre/info {:Hello "Timbre!"})
19-09-29 05:02:44 UnknownHost INFO [wheel.infra.log:1] - {:Hello "Timbre!"}
nil
```

## Customizing the Output Log Format

The default output format is naive and not friendly for reading by an external tool like [logstash](https://www.elastic.co/products/logstash). We can modify the behaviour and use JSON as our output format by following the below steps. 

Let's add the [Chesire](https://github.com/dakrone/cheshire) library to take care of JSON serialization in the *project.clj* file and restart the REPL. 

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [chesire "5.9.0"]]
  ; ...
  )
```
Timbre provides a hook `output-fn`, a function with the signature `(fn [data]) -> string`, to customize the output format. The data is a map that contains the actual message, log level, timestamp, hostname and much more.

```clojure
; src/wheel/infra/log.clj
; ...
(defn- json-output [{:keys [level msg_ instant]}] ;<1>
  (let [event (read-string (force msg_))] ;<2>
    (json/generate-string {:timestamp instant ;<3>
                           :level level
                           :event event})))
```

<span class="callout">1</span> It destructures the interested keys from the `data` map. 

<span class="callout">2</span> Timbre use [delay](https://clojuredocs.org/clojure.core/delay) for the logging message. So, here we are retrieving the value using the [force](https://clojuredocs.org/clojure.core/force) function and then uses [read-string](https://clojuredocs.org/clojure.core/read-string) to convert the `string` to its corresponding Clojure data structure.

<span class="callout">3</span> It generates the stringified JSON representation of the log entry containing the log level, timestamp and the actual message. 

To wire this function with Timbre, we are going to make use of its `merge-config!` function.

```clojure
; src/wheel/infra/log.clj
; ...
(defn init []
  (timbre/merge-config! {:output-fn json-output}))
```

As the name indicates, the `init` function acts as the entry point for initialization the logging, and here we are modifying the Timbre's config to use our `json-output` function as its `output-fn` function.

Now if we log after calling this `init` function, we will get the output as below.

```clojure
wheel.infra.log=> (init)
{:level :debug, :ns-whitelist [], :ns-blacklist [] ...}
```

```clojure
wheel.infra.log=> (timbre/info {:name :an-event/succeeded})
{"timestamp":"2019-09-29T05:30:42Z", "level":"info","event":{"name":"an-event/succeeded"}}
nil
```

Let's invoke this `init` function from the application's `start-app` function to set up this configuration during application bootstrap.

```diff
 (ns wheel.infra.core
   (:require [mount.core :as mount]
+            [wheel.infra.log :as log]
             [wheel.infra.config :as config]
             [wheel.infra.database :as db]))

 (defn start-app []
+  (log/init)
   (mount/start))
...
```

## Logs as the Single Source of Truth

The middleware that we built acts as a liaison between our client's order management system(OMS) and the e-commerce marketplaces.

![](/img/clojure/blog/ecom-middleware/middleware-10K-View.png)

Logging all the business (domain) event occurred in or processed by the middleware is one of the critical requirement. We incorporated it by defining functions that either returns an event (a Clojure map) or a list of events. 

At the boundaries of the system, we consume these data and write it to a log. In the logging configuration, we had a database appender which projects the log entries (events) to a table. We'll learn more about it in the upcoming blog posts.

In this blog post, we are going to focus on modelling the event.

### Modelling Event using clojure.spec

An event in the wild is a Clojure map with a bunch of key-value pairs. But treating the event like this will be hard to develop and maintain. So, we need a specification of what constitutes an event. We are going to make use of [clojure.spec](https://clojure.org/guides/spec) to define it.

Let's get started by creating a new file *event.clj* and add the spec for the individual keys.

```bash
> mkdir src/wheel/middleware
> touch src/wheel/middleware/event.clj
```

```clojure
(ns wheel.middleware.event
  (:require [clojure.spec.alpha :as s]))

(s/def ::id uuid?)
(s/def ::parent-id ::id) ; <1>
(s/def ::name qualified-keyword?) ; <2>
(s/def ::level #{:info :warn :debug :error :fatal})
```

<span class="callout">1</span> As the name indicates, the `parent-id` represents the `id` of an event which resulted in the event in question.

<span class="callout">2</span> An event name is a namespaced keyword. We'll discuss it more in the upcoming blog posts.

To model the timestamp of the event, we are going to take advantage of the fact our Client works on IST(+05:30) timezone and all their transactions are on IST. 

Let's add the `ist-timestamp` spec in a new file `offset-date-time.clj`. We will be using [ISO 8061](https://en.wikipedia.org/wiki/ISO_8601#Combined_date_and_time_representations) combined date-time representation with a time zone designator.

```bash
> touch src/wheel/offset-date-time.clj
```

```clojure
(ns wheel.offset-date-time
  (:require [clojure.spec.alpha :as s])
  (:import [java.time.format DateTimeFormatter
                             DateTimeParseException]
           [java.time OffsetDateTime]))

(defn iso-8061-format? [x]
  (try
    (.parse DateTimeFormatter/ISO_OFFSET_DATE_TIME x)
    true
    (catch DateTimeParseException e
      false)))

(defn ist? [x]
  (if (iso-8061-format? x)
    (= (.. (OffsetDateTime/parse x) getOffset toString)
       "+05:30")
    false))

(s/def ::iso-8061-format (s/and string? iso-8061-format?))
(s/def ::ist-timestamp (s/and ::iso-8061-format ist?))
```

We can verify it in the REPL as below.

```clojure
wheel.offset-date-time=> (s/valid? ::ist-timestamp "2007-04-05T12:30-02:00")
false
wheel.offset-date-time=> (s/valid? ::ist-timestamp "2019-10-01T06:56+05:30")
true
```

Then in `event.clj`, use this `ist-timestamp` spec to define the `timestamp` spec.

```clojure
; src/wheel/middleware/event.clj
(ns wheel.middleware.event
  (:require ; ...
            [wheel.offset-date-time :as offset-date-time]))
; ...
(s/def ::timestamp ::offset-date-time/ist-timestamp)
```

There are two types of events in the middleware, `system` and `domain` events.

The `system` events represent the events associated with the technical implementation of the application like `db.migration/failed`, `ibm-mq.connection/failed`, and so on. 

As you correctly guessed, the `domain` events represent business-specific events in the middleware.

```clojure
; src/wheel/middleware/event.clj
; ...
(s/def ::type #{:domain :system})
```

All the `domain` events should have a `channel-id` and `channel-name`. The term `channel` represents the e-commerce marketplace (Amazon, Flipkart or Tata CliQ) through which our client sells their products.

To define the spec for the `channel-id` (a non-empty string identifier from OMS), `channel-name` (an enumeration of markplaces), create a new file `channel.clj`.

```bash
> mkdir src/wheel/marketplace
> touch src/wheel/marketplace/channel.clj
```

```clojure
(ns wheel.marketplace.channel
  (:require [clojure.spec.alpha :as s]))

(s/def ::id (complement clojure.string/blank?))
(s/def ::name #{:tata-cliq :amazon :flipkart})
```

Then we can use this spec in the event spec.

```clojure
; src/wheel/middleware/event.clj
(ns wheel.middleware.event
  (:require ; ...
            [wheel.marketplace.channel :as channel]))
; ...
(s/def ::channel-id ::channel/id)
(s/def ::channel-name ::channel/name)
```

Now we have all the individual attributes of an event, and we can define the spec of the `event` itself using Clojure's [multi-spec](https://clojure.org/guides/spec#_multi_spec)

```clojure
; src/wheel/middleware/event.clj
; ...

(defmulti event-type :type) ; <1>
(defmethod event-type :system [_] ; <2>
  (s/keys :req-un [::id ::name ::type ::level ::timestamp]
          :opt-un [::parent-id]))
(defmethod event-type :domain [_] ; <3>
  (s/keys :req-un [::id ::name ::type ::level ::timestamp
                   ::channel-id ::channel-name]
          :opt-un [::parent-id]))
(defmethod event-type :default [_] ; <4>
  (s/keys :req-un [::type]))

(s/def ::event (s/multi-spec event-type :type))
```

<span class="callout">1</span> It defines multi-method dispatch based of the `:type` key.

<span class="callout">2</span> It defines the `:system` event spec.

<span class="callout">3</span> It defines the `:domain` event spec.

<span class="callout">4</span> It defines the default event spec which requires an event map with a `:type` key and conforms to the `::type` spec.

Let's verify the spec in the REPL

```clojure
wheel.middleware.event=> (s/valid?
                          ::event
                          {:name :ranging/succeeded
                          :type :domain
                          :channel-id "UA"
                          :level :info
                          :timestamp "2019-10-01T12:30+05:30"
                          :id (java.util.UUID/randomUUID)
                          :channel-name :tata-cliq})
true
```

```clojure
wheel.middleware.event=> (s/valid?
                          ::event
                          {:name :db.migration/failed
                            :type :system
                            :level :fatal
                            :timestamp "2019-10-01T12:30+05:30"
                            :id (java.util.UUID/randomUUID)})
true
```

We will revisiting this event spec, when we are implementing the business requirements.

### Asserting & Logging Event

We are going to add a function `write!` in the *log.clj* file that takes an `event` and writes it to the log using Timbre. The application boundaries will use this function to perform the logging. 

```clojure
; src/wheel/infra/log.clj
(ns wheel.infra.log
  (:require ; ...
            [clojure.spec.alpha :as s]
            [wheel.middleware.event :as event]))
; ...

(defn write! [{:keys [level] :as event}] ; <1>
  {:pre [(s/assert ::event/event event)]} ; <2>
  (case level ; <3>
    :info (timbre/info event)
    :debug (timbre/debug event)
    :warn (timbre/warn event)
    :error (timbre/error event)
    :fatal (timbre/fatal event)))
```

<span class="callout">1</span>It destructures the `level` from the `event` and also keeps the `event`

<span class="callout">2</span>It uses the Clojure's function [pre-condition](https://clojure.org/reference/special_forms#_fn_name_param_condition_map_expr_2) to assert the incoming parameter against the `event` spec.

<span class="callout">3</span>It invokes the appropriate `log` macros of the Timbre library based on the event's `level`.

When we evaluate this `write!` function with a random map, we'll get the following output.

```clojure
wheel.infra.log=> (write! {:level :info :name :foo})
{"timestamp":"2019-10-01T15:46:22Z","level":"info","event":{"level":"info","name":"foo"}}
nil
```

If you are wondering the pre-condition didn't get executed, it's because Clojure spec's asserts as disabled by default, we need to enable them.

```clojure
wheel.infra.log=> (s/check-asserts true)
true
wheel.infra.log=> (write! {:level :info :name :foo})
Execution error - invalid arguments to wheel.infra.log/write! at (log.clj:17).
{:level :info, :name :foo} - failed: (contains? % :type) at: [nil]
class clojure.lang.ExceptionInfo
# ... Stack traces ignored for brevity
```

After enabling the asserts checking it is now working as expected. 

In our application, we are going to turn on the `check-asserts` by setting it up during application startup. 

```clojure
; src/wheel/infra/core.clj

(ns wheel.infra.core
  (:require ; ...
            [clojure.spec.alpha :as s]))

(defn start-app
  ([] 
   (start-app true))
  ([check-asserts]
   (log/init)
   (s/check-asserts check-asserts)
   (mount/start)))

; ...
```

The rewritten version of `start-app` is a multi-arity function that optionally accepts a parameter to set the `check-asserts` flag. Typically in the production environment, we can turn off this flag.

To log multiple events, let's add the `write-all!` function, which invokes the `write!` function for each provided events.

```clojure
; src/wheel/infra/log.clj
; ...
(defn write-all! [events]
  (run! write! events))
```

As a final step, rewrite the `json-output` function to log the event itself as it already contains the timestamp and level.

```clojure
; src/wheel/infra/log.clj
; ...

(defn- json-output [{:keys [msg_]}]
  (let [event (read-string (force msg_))]
    (json/generate-string event)))
```

## Summary

In this blog post, we learned how to configure Timbre with JSON output and also created abstractions `write!` & `write-all!` to do the logging. In the upcoming blog posts, we are going to add database and Slack appenders. Stay tuned!

The source code associated with this part is available on [this GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.15/clojure/wheel) repository.