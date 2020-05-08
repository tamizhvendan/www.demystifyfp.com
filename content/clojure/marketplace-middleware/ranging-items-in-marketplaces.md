---
title: "Ranging Items In E-Commerce Marketplaces"
date: 2019-10-18T20:58:27+05:30
tags: ["clojure"]
---

In this seventh part of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}), I am going to share how we captured a business operation from the client's Order Management System(OMS) processed it in a marketplace. 

**Ranging** is an activity in the OMS that turn on the visibility of an item in a marketplace and make it available for sale. The reverse operation is **Deranging**, which unlist the item from the marketplace. There are two more operations **Inventorying** and **Pricing** which updates the inventory and the pricing of the items in the marketplace, respectively. 

The back-office team of the Client perform these operations in their OMS. In turn, the OMS communicates the performed action to the middleware through IBM-MQ using XML encoded message.

This blog post is going to be a long one. So, here is a sneak preview of what we'll be learning on the Clojure implementation front.

* A variant of the [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/talks/boundaries) technique in action.
* More Clojure.Spec (and multi-spec) and asserting the public function parameters using it.
* XML Parsing & Validation
* Persisting JSON data in PostgreSQL using Toucan and much more.

### Unified Message Handling

The handling logic of all these operational messages will be as follows.

![](/img/clojure/blog/ecom-middleware/message-handling-process.png)


1. Upon receiving the message, we log the message as an OMS event. It help us to keep track of the messages that we received from the OMS.

2. Then we parse the message. If it is a failure, we will be logging it as an error in the form of a System event.

3. If parsing is successful, for each channel in the message, we check whether the given channel exists. 

4. If the channel exists, we will be performing the respective operation in the marketplace. If the processing succeeds, we log it as a domain success event else we log it as a domain failure event. 

5. If the channel not found, we'll be logging as a system event.

Events from steps two to five, treats the OMS event (step one) as the parent event. 

In the rest of the blog post, we'll be talking about the implementation of Ranging message and the marketplace [Tata-CliQ](https://www.tatacliq.com/) alone.

### Revisiting Event Spec

As a first step towards implementing this unified message handling, let's start from adding the spec for the `:oms` event type.

```diff
# src/wheel/middleware/event.clj

- (s/def ::type #{:domain :system })
+ (s/def ::type #{:domain :system :oms})
```

```clojure
; src/wheel/middleware/event.clj
; ...
(defmethod event-type :oms [_]
  (s/keys :req-un [::id ::name ::type ::level ::timestamp]))
```

#### Adding Payload Spec

All three event types are going to have payloads that provide extra information about an event. To specify different payload specs, we first need to define the different event names.

```clojure
; src/wheel/middleware/event.clj
; ...
(s/def ::oms-event-name #{:oms/items-ranged})
(s/def ::domain-event-name #{})
(s/def ::system-event-name #{:system/parsing-failed
                             :system/channel-not-found})

(s/def ::name ...
; ...
```

* `:oms/items-ranged` - Ranging message received from OMS
* `:system/parsing-failed` - Parsing ranging message failed.
* `:system/channel-not-found` - Channel specified in the ranging message not found.

> We are leaving the `domain-event-name` spec as an empty set for now.

Earlier we had the had the spec for the `name` as `qualified-keyword?`. We have to change it to either one of the above event-name spec.

```diff
# src/wheel/middleware/event.clj

- (s/def ::name qualified-keyword?)
+ (s/def ::name (s/or :oms ::oms-event-name 
+                     :domain ::domain-event-name
+                     :system ::system-event-name))
```

Before defining the payload type for these event-names, let's add the spec for the messages from OMS.

```bash
> touch src/wheel/oms/message.clj
```

```clojure
; src/wheel/oms/message.clj
(ns wheel.oms.message
  (:require [clojure.spec.alpha :as s]))

(s/def ::type #{:ranging})
(s/def ::id uuid?)
(s/def ::message (s/and string? (complement clojure.string/blank?)))

(s/def ::oms-message
       (s/keys :req-un [::type ::id ::message]))
```

Then add the event payload spec as below.

```clojure
; src/wheel/middleware/event.clj
(ns wheel.middleware.event
  (:require ; ...
            [wheel.oms.message :as oms-message]))
; ...
(defmulti payload-type :type)

(defmethod payload-type :oms/items-ranged [_]
  (s/keys :req-un [::oms-message/message]))

(s/def ::error-message (s/and string? (complement clojure.string/blank?)))

(s/def ::message-type ::oms-message/type)
(defmethod payload-type :system/parsing-failed [_]
  (s/keys :req-un [::error-message ::message-type]))

(defmethod payload-type :system/channel-not-found [_]
  (s/keys :req-un [::channel-id ::message-type]))

(defmethod payload-type :default [_]
  (s/keys :req-un [::type]))
(s/def ::payload (s/multi-spec payload-type :type))

(defmulti event-type ...
; ...
```

Finally, add this `payload` spec in all the `event` spec.

```diff
# src/wheel/middleware/event.clj

(defmethod event-type :system [_]
-  (s/keys :req-un [::id ::name ::type ::level ::timestamp]
+  (s/keys :req-un [::id ::name ::type ::level ::timestamp ::payload]
           :opt-un [::parent-id]))
(defmethod event-type :domain [_]
-  (s/keys :req-un [::id ::name ::type ::level ::timestamp 
+  (s/keys :req-un [::id ::name ::type ::level ::timestamp ::payload
                    ::channel-id ::channel-name]
           :opt-un [::parent-id]))
(defmethod event-type :oms [_]
-  (s/keys :req-un [::id ::name ::type ::level ::timestamp]))
+  (s/keys :req-un [::id ::name ::type ::level ::timestamp ::payload]))
```

#### System Processing Failed Event

To model the unhandled exception while processing a message from OMS, let's add a new event name `:system/processing-failed`.

```clojure
; src/wheel/middleware/event.clj
; ...
(s/def ::system-event-name #{ ;...
                             :system/processing-failed})
; ...
(s/def ::stacktrace (s/and string? (complement clojure.string/blank?)))

(defmethod payload-type :system/processing-failed [_]
  (s/keys :req-un [::error-message ::stacktrace]
          :opt-un [::message-type]))

; ...
```


### Implementing Unified Message Handler

With the spec for all the possible events in place, now it's time to implement the message handler for the messages from OMS.

Let's start it from the rewriting message listener that we implemented in the [last blog post]({{<relref "processing-messages-from-ibmmq-in-clojure.md#consuming-messages-from-ibm-mq-queue">}})

```clojure
; src/wheel/infra/oms.clj
(ns wheel.infra.oms
  (:require ; ...
            [wheel.middleware.event :as event]
            [wheel.middleware.core :as middleware] ; <1>
            [wheel.infra.log :as log])
  ; ...
  )
; ...
(defn- message-listener [message-type oms-event-name] ; <2>
  (proxy [MessageListener] []
    (onMessage [^Message msg]
      (try
        (let [message   (.getBody msg String)
              oms-event (event/oms oms-event-name message)] ; <3>
          (->> (middleware/handle {:id      (:id oms-event) ; <4>
                                   :message message
                                   :type    message-type}) 
               (cons oms-event) ; <5>
               log/write-all!)) ; <6>
        (catch Throwable ex 
          (log/write! (event/processing-failed ex))))))) ; <7>
; ...
```

<span class="callout">1</span> & <span class="callout">4</span> The namespace `wheel.middleware.core` doesn't exist yet. We'll be adding it in a  few minutes. This namespace is going to have a function `handle` that takes `oms-message` and performs the required actions in the marketplace. Then it returns a collection of events that represent the results of these actions. Think of this as a router in a web application.

<span class="callout">2</span> The rewritten version of the `message-listener` function now takes two parameters, `message-type` and  `oms-event-name`. These parameters make it generic for processing the different types of messages from OMS.

<span class="callout">3</span> & <span class="callout">7</span> The `oms` and `processing-failed` functions in the `wheel.middleware.event` namespace is also not added yet, and we'll be adding them in the next step. These functions construct an event of type `oms` and `system` with the parameters passed.

<span class="callout">5</span> We are prepending the `oms-event` with the results from the `handle` functions. This `oms-event` is the parent event that triggered all the other events 

<span class="callout">6</span> We are writing all the events in the log using the `write-all!` function that we defined earlier. 

As we have changed the signature of the `message-listener` function, let's update the `ranging-consumer` state that we defined using it.

```diff
  (mount/defstate ranging-consumer
    :start (let [queue-name (:ranging-queue-name (config/oms-settings))
-                listener   (message-listener)]
+                listener   (message-listener :ranging :oms/items-ranged)]
            (start-consumer queue-name jms-ranging-session listener))
    :stop (stop ranging-consumer))
```

Here we are creating of message-listener for handling the `:ranging` message from the OMS, and we name the message received from OMS as `:oms/items-ranged`

This design follows a variant of the [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/talks/boundaries) technique.

#### Adding Event Create Functions

In the `message-listener` function, we are calling two functions `event/oms` to `event/processing-failed` to create events. These functions don't exist yet. So, let's add it.

```diff
# src/wheel/offset-date-time.clj

  (ns wheel.offset-date-time
    (:require [clojure.spec.alpha :as s])
    (:import [java.time.format DateTimeFormatter DateTimeParseException]
-            [java.time OffsetDateTime]))	           
+            [java.time OffsetDateTime ZoneId]))
# ...
+ (defn ist-now []
+   (OffsetDateTime/now (ZoneId/of "+05:30")))
```

```clojure
; src/wheel/middleware/event.clj
(ns wheel.middleware.event
  (:require ; ...
            [clojure.stacktrace :as stacktrace]
            [wheel.offset-date-time :as offset-date-time]
            [wheel.oms.message :as oms-message])
  (:import [java.util UUID]))
; ...

(defn- event [event-name payload &{:keys [level type parent-id
                                          channel-id channel-name]
                                   :or   {level :info
                                          type  :domain}}] ; <1>
  {:post [(s/assert ::event %)]}
  (let [event {:id        (UUID/randomUUID)
               :timestamp (str (offset-date-time/ist-now))
               :name      event-name
               :level     level
               :type      type
               :payload   (assoc payload :type event-name)}]
    (cond-> event
     parent-id (assoc :parent-id parent-id)
     channel-id (assoc :channel-id channel-id)
     channel-name (assoc :channel-name channel-name))))

(defn oms [oms-event-name message]
  {:pre [(s/assert ::oms-event-name oms-event-name)
         (s/assert ::oms-message/message message)]
   :post [(s/assert ::event %)]}
  (event oms-event-name 
         {:message message}
         :type :oms))

(defn- ex->map [ex]
  {:error-message (with-out-str (stacktrace/print-throwable ex))
   :stacktrace (with-out-str (stacktrace/print-stack-trace ex 3))})

(defn processing-failed [ex]
  {:post [(s/assert ::event %)]}
  (event :system/processing-failed
         (ex->map ex)
         :type :system
         :level :error))
```

<span class="callout">1</span> The `event` function takes the name and payload (without type) of the event along with a set of [keyword arguments](https://clojure.org/guides/destructuring#_keyword_arguments) and constructs a Clojure map that conforms to the `event` spec.

Let's also add the `parsing-failed` function to construct the `parsing-failed` event which we will be using shortly.

```clojure
; src/wheel/middleware/event.clj
; ...
(defn parsing-failed [parent-id message-type error-message]
  {:pre [(s/assert uuid? parent-id)
         (s/assert ::oms-message/type message-type)
         (s/assert ::error-message error-message)]
   :post [(s/assert ::event %)]}
  (event :system/parsing-failed 
         {:error-message error-message
          :message-type message-type}
         :parent-id parent-id
         :type :system
         :level :error))
```

#### Adding Generic Message Handler

The `message-listener` function at the application boundary creates the `oms-message` with the message received from IBM-MQ and pass it to the middleware to handle. This middleware's `handle` function also not implemented yet. So, let's add it as well.

```bash
> touch src/wheel/middleware/core.clj
```

The messages from OMS are XML encoded. So, the handler has to validate it against an [XML schema](https://en.wikipedia.org/wiki/XML_Schema_(W3C)). If it is valid, then it has to be parsed to a Clojure data structure (sequence of maps). 

This parsed data structure is also needed to be validated using clojure.spec to make sure that the message is a processable one. If the validation fails in either one of this, we'll be returning the `parsing-failed` event.

```clojure
(ns wheel.middleware.core
  (:require [clojure.spec.alpha :as s]
            [clojure.java.io :as io]
            [wheel.middleware.event :as event]
            [wheel.oms.message :as oms-message]
            [wheel.xsd :as xsd]))

; <1>
(defmulti xsd-resource-file-path :type) 
(defmulti parse :type)
(defmulti spec :type)

(defmulti process (fn [oms-msg parsed-oms-message] ; <2>
                    (:type oms-msg)))

(defn- validate-message [oms-msg]
  (-> (xsd-resource-file-path oms-msg)
      io/resource
      io/as-file
      (xsd/validate (:message oms-msg)))) ; <3>

(defn handle [{:keys [id type]
               :as   oms-msg}]
  {:pre  [(s/assert ::oms-message/oms-message oms-msg)]
   :post [(s/assert (s/coll-of ::event/event :min-count 1) %)]}
  (if-let [err (validate-message oms-msg)]
    [(event/parsing-failed id type err)]
    (let [parsed-oms-message (parse oms-msg)]
      (if (s/valid? (spec oms-msg) parsed-oms-message)
        (process oms-msg parsed-oms-message) ; <4>
        [(event/parsing-failed
          id type
          (s/explain-str (spec oms-msg) parsed-oms-message))]))))
```

<span class="callout">1</span> & <span class="callout">2</span> We are defining three multi-methods `xsd-resource-file-path`, `parse` & `spec` to get the XML schema file path in the *resources* directory, parse the XML message to Clojure data structure and to get the expected clojure.spec of the parsed message respectively. The `process` multi-method abstracts the processing of the parsed message from OMS. Each OMS message type (ranging, deranging, etc.) has to have an implementation for these multi-methods. 

<span class="callout">3</span> The `validate-message` performs the XML schema-based validation of the incoming message. We'll be adding the `wheel.xsd/validate` function shortly.

<span class="callout">4</span> We are dispatching the parsed OMS message to the `process` multimethod.

Then add a new file *xsd.clj* and implement the XML validation based on XSD as mentioned in this [stackoverflow answer](https://stackoverflow.com/questions/15732/whats-the-best-way-to-validate-an-xml-file-against-an-xsd-file).

```bash
> touch src/wheel/xsd.clj
```

```clojure
; src/wheel/xsd.clj
(ns wheel.xsd
  (:import [javax.xml.validation SchemaFactory]
           [javax.xml XMLConstants]
           [org.xml.sax SAXException]
           [java.io StringReader File]
           [javax.xml.transform.stream StreamSource]))

(defn validate [^File xsd-file ^String xml-content]
  (let [validator (-> (SchemaFactory/newInstance 
                       XMLConstants/W3C_XML_SCHEMA_NS_URI)
                      (.newSchema xsd-file)
                      (.newValidator))]
    (try
      (->> (StringReader. xml-content)
           StreamSource.
           (.validate validator))
      nil
      (catch SAXException e (.getMessage e)))))
```

This `validate` function takes a `xsd-file` of type `java.io.File` and the `xml-content` of type `String`. It returns either `nil` if the `xml-content` conforms to the XSD file provided or the validation error message otherwise. 


#### Adding Ranging Message Handler

A sample ranging message from the OMS would look like this

```xml
<EXTNChannelList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UA" EAN="EAN_1" ItemID="SKU1" RangeFlag="Y"/>
    <EXTNChannelItem ChannelID="UA" EAN="EAN_2" ItemID="SKU2" RangeFlag="Y"/>
  </EXTNChannelItemList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UB" EAN="EAN_3" ItemID="SKU3" RangeFlag="Y"/>
  </EXTNChannelItemList>
</EXTNChannelList>
```

The `EXTNChannelItemList` element(s) specifies which channel that we have to communicate and the `EXTNChannelItem` element(s) determines the items that have to be ranged in that channel.

The XSD file for the ranging message is available in [this gist](https://gist.github.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c#file-ranging-xsd)

To keep this XSD file (and the future XSD files), create a new directory *oms/message_schema* under *resources* directory and download the gist there.

```bash
> mkdir -p resources/oms/message_schema
> wget https://gist.githubusercontent.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c/raw/2c2112bde069f6d002c184e8cfc5a6db77fbebcb/ranging.xsd -P resources/oms/message_schema 

# ...
- 'resources/oms/message_schema/ranging.xsd' saved 
```

Then create the *ranging.clj* file under *middleware* directly and implement the `xsd-resource-file-path` multimethod which returns the above XSD file path.

```clojure
; src/wheel/middleware/ranging.clj
(ns wheel.middleware.ranging
  (:require [wheel.middleware.core :as middleware]))

(defmethod middleware/xsd-resource-file-path :ranging [_]
  "oms/message_schema/ranging.xsd")
```

Then let's define the spec for the ranging message.

Given we are receiving the above sample XML as a message, we will be transforming it to a Clojure sequence as below.

```clojure
({:channel-id "UA", :items ({:ean "EAN_1", :id "SKU1"} 
                            {:ean "EAN_2 ", :id "SKU2"})}
 {:channel-id "UB", :items ({:ean "EAN_3", :id "SKU3"})})
```

To add a spec for this, Let's add the spec for the `id` and the `ean` of the item.

```bash
> mkdir src/wheel/oms
> touch src/wheel/oms/item.clj
```

```clojure
; src/wheel/oms/item.clj
(ns wheel.oms.item
  (:require [clojure.spec.alpha :as s]))

(s/def ::id (s/and string? (complement clojure.string/blank?)))
(s/def ::ean (s/and string? (complement clojure.string/blank?)))
```

Then use these specs to define the spec for the ranging message and return it in the `spec` multi-method implementation.

```clojure
; src/wheel/middleware/ranging.clj
(ns wheel.middleware.ranging
  (:require ; ...
            [clojure.spec.alpha :as s]
            [wheel.oms.item :as oms-item]
            [wheel.marketplace.channel :as channel]))

; ...

(s/def ::item
  (s/keys :req-un [::oms-item/ean ::oms-item/id]))

(s/def ::items (s/coll-of ::item :min-count 1))

(s/def ::channel-id ::channel/id)
(s/def ::channel-items
  (s/keys :req-un [::channel-id ::items]))

(s/def ::message
  (s/coll-of ::channel-items :min-count 1))

(defmethod middleware/spec :ranging [_]
  ::message)
```

The next step is parsing the XML content to a ranging message that satisfies the above spec.

The [parse](https://clojuredocs.org/clojure.xml/parse) function from `clojure.xml` namespace parses the XML and returns a tree of XML elements. 

```clojure
wheel.middleware.ranging==> (clojure.xml/parse (java.io.StringBufferInputStream. "{above xml content}"))
{:attrs nil,
 :content [{:attrs nil,
            :content [{:attrs {:ChannelID "UA", :EAN "UA_EAN_1", 
                               :ItemID "SKU1", :RangeFlag "Y"},
                       :content nil,
                       :tag :EXTNChannelItem}
                      {:attrs {:ChannelID "UA", :EAN "UA_EAN_2 ", 
                               :ItemID "SKU2", :RangeFlag "Y "},
                       :content nil,
                       :tag :EXTNChannelItem}],
            :tag :EXTNChannelItemList}
           {:attrs nil,
            :content [{:attrs {:ChannelID "UB", :EAN "UB_EAN_3", 
                               :ItemID "SKU3", :RangeFlag "Y"},
                       :content nil,
                       :tag :EXTNChannelItem}],
            :tag :EXTNChannelItemList}],
 :tag :EXTNChannelList}
```

And we have to transform it to

```clojure
({:channel-id "UA", :items ({:ean "EAN_1", :id "SKU1"} 
                            {:ean "EAN_2 ", :id "SKU2"})}
 {:channel-id "UB", :items ({:ean "EAN_3", :id "SKU3"})})
```

Let's do it

```clojure
; src/wheel/middleware/ranging.clj
(ns wheel.middleware.ranging
  (:require ; ...
            [clojure.xml :as xml])
  (:import [java.io StringBufferInputStream]))

; ...

(defn- to-item [{:keys [EAN ItemID]}]
  {:ean EAN
   :id ItemID})

(defmethod middleware/parse :ranging [{:keys [message]}]
  (->> (StringBufferInputStream. message)
       xml/parse
       :content
       (mapcat :content)
       (map :attrs)
       (group-by :ChannelID)
       (map (fn [[id xs]]
              {:channel-id  id
               :items (map to-item xs)}))))
```

> Note: This kind of nested data transformation can also be achieved using [XML Zippers](https://ravi.pckl.me/short/functional-xml-editing-using-zippers-in-clojure) or [Meander](https://github.com/noprompt/meander).

The last multimethod that we need to define is `process`. To begin with, let's throw an exception in the implementation.

```clojure
; src/wheel/middleware/ranging.clj
; ...

(defmethod middleware/process :ranging [_ ranging-message]
  (throw (Exception. "todo")))
```

To load these multimethod definitions during application bootstrap, let's refer this namespace in the *infra/core.clj* file

```clojure
; src/wheel/infra/core.clj
(ns wheel.infra.core
  (:require ; ...
            [wheel.middleware.ranging :as ranging]))
; ...
```

### Revisiting Slack Appender

To make the Slack appender that [we added earlier]({{<relref "using-slack-as-log-appender.md">}}) more meaningful, let's change the implementation of the `event->attachment` and `send-to-slack` function like below

```clojure
; src/wheel/infra/log_appender/slack.clj
(ns wheel.infra.log-appender.slack
  (:require [wheel.slack.webhook :as slack]
            [wheel.infra.config :as config]
            [cheshire.core :as json]))

; ...

(defn- event->attachment [{:keys [id channel-id channel-name parent-id payload]
                           :or   {channel-name "N/A"
                                  channel-id   "N/A"
                                  parent-id    "N/A"}}]
  {:color  :danger
   :fields [{:title "Channel Name"
             :value channel-name
             :short true}
            {:title "Channel Id"
             :value channel-id
             :short true}
            {:title "Event Id"
             :value id
             :short true}
            {:title "Parent Id"
             :value parent-id
             :short true}
            {:title "Payload"
             :value (str
                     "```"
                     (json/generate-string (dissoc payload :type)
                                           {:pretty true})
                     "```")}]})

(defn- send-to-slack [{:keys [msg_]}]
  (let [event      (read-string (force msg_))
        text       (event->text event)
        attachment (event->attachment event)]
    (slack/post-message! (config/slack-log-webhook-url) text [attachment])))
; ...
```

When we test drive the app by reloading the application in the REPL and putting the following the XML messages in the IBM MQ, we'll get the respective notification in the Slack.

```xml
<EXTNChannelList>
</EXTNChannelList>
```

![](/img/clojure/blog/ecom-middleware/invalid-xml-slack-error.png)

```xml
<EXTNChannelList>
  <EXTNChannelItemList>
    <!-- An empty space in the Channel ID -->
    <EXTNChannelItem ChannelID=" " EAN="EAN_1" ItemID="SKU1" RangeFlag="Y"/>
  </EXTNChannelItemList>
</EXTNChannelList>
```

![](/img/clojure/blog/ecom-middleware/invalid-spec-slack-error.png)

Finally, a valid ranging XML message will throw the "todo" exception.

```xml
<EXTNChannelList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UA" EAN="EAN_1" ItemID="SKU1" RangeFlag="Y"/>
  </EXTNChannelItemList>
</EXTNChannelList>
```
![](/img/clojure/blog/ecom-middleware/todo-slack-error.png)

Everything is working as expected! Let's move to the final step of processing the `ranging` message.

### Processing Ranging In A Marketplace Channel

The processing of a OMS message in a marketplace channel involves the calling the respective API provided the marketplace. To keep this simple, we are going to a mock a HTTP server that accepts the following HTTP request

```
POST /channels/UA/ranging HTTP/1.1
Host: localhost:3000
Content-Type: application/json
Authorization: Bearer top-secret!
Accept: */*
Content-Length: 79

[{
	"ean" : "EAN_1",
	"sku" : "SKU_1"
},{
	"ean" : "EAN_2",
	"sku" : "SKU_2"
}]
```

To perform this action, let's add a `tata-cliq` API client that implements this fake request for ranging.

```bash
> mkdir src/wheel/marketplace/tata_cliq
> touch src/wheel/marketplace/tata_cliq/api.clj
```

```clojure
; src/wheel/marketplace/tata_cliq/api.clj
(ns wheel.marketplace.tata-cliq.api
  (:require [clj-http.client :as http]))

(defn ranging [{:keys [base-url bearer-token]} channel-id items]
  (let [url         (str base-url "/channels/" channel-id "/ranging")
        auth-header (str "Bearer " bearer-token)]
    (http/post url {:form-params  items
                    :content-type :json
                    :headers      {:authorization auth-header}})))
```

Then update the *config.edn* to store the channel settings (`base-url` & `bearer-token`) and expose it a via a function in *config.clj*.

```clojure
; resources/config.edn
{:app      ...
 :settings {...
            :channels {"UA" {:channel-name  :tata-cliq
                             :base-url     "http://localhost:3000"
                             :bearer-token "top-secret!"}
                       "UB" {:channel-name :tata-cliq
                             :base-url     "http://localhost:3000"
                             :bearer-token "top-secret!"}}}}}
```

```clojure
; src/wheel/infra/config.clj
; ...
(defn get-channel-cofig [channel-id]
  (get-in root [:settings :channels channel-id]))
```

To perform the ranging in the marketplace(s) in response to a message from OMS, we need to define a multimethod `process-ranging` that dispatches based on the `channel-name`

```clojure
; src/wheel/middleware/ranging.clj
; ...
(defmulti process-ranging (fn [{:keys [channel-name]} 
                               oms-msg 
                               ranging-message]
                            channel-name))

(defmethod middleware/process ... )
```

Then rewrite the `middleware/process` multimethod implementation to iterate through each channel in the ranging message, and invoke the `process-ranging` method after  getting their configuration. 

```clojure
; src/wheel/middleware/ranging.clj
(ns wheel.middleware.ranging
  (:require ; ...
            [middleware.infra.event :as event]))
; ...

(defmethod middleware/process :ranging [{:keys [id]
                                         :as oms-msg} ranging-message]
  (for [{:keys [channel-id]
         :as   ch-ranging-message} ranging-message]
    (if-let [channel-config (config/get-channel-cofig channel-id)]
      (try
        (process-ranging channel-config oms-msg ch-ranging-message)
        (catch Throwable ex
          (event/processing-failed ex id :ranging channel-id (:channel-name channel-config))))
      (event/channel-not-found id :ranging channel-id))))
```

The `channel-not-found` function and `processing-failed` function overload are not available, so let's add them.

```clojure
; src/wheel/middleware/event.clj
; ...
(defn processing-failed 
  ([ex]
   ; ... existing implementation
   )
  ([ex parent-id message-type channel-id channel-name]
   {:post [(s/assert ::event %)]}
   (event :system/processing-failed
          (assoc (ex->map ex) :message-type message-type)
          :parent-id parent-id
          :channel-id channel-id
          :channel-name channel-name
          :level :error)))
; ...
(defn channel-not-found [parent-id message-type channel-id]
  {:pre [(s/assert uuid? parent-id)
         (s/assert ::oms-message/type message-type)
         (s/assert ::channel/id channel-id)]
   :post [(s/assert ::event %)]}
  (event :system/channel-not-found
         {:channel-id channel-id
          :message-type message-type}
         :parent-id parent-id
         :type :system
         :level :error))
```

As we'll be adding the `ranging/succeeded` event, let's add the spec for this as well.

```clojure
; src/wheel/middleware/event.clj
(s/def ::domain-event-name #{:ranging/succeeded})
; ...
(s/def ::ranged-item
  (s/keys :req-un [::item/ean ::item/id]))
(s/def ::ranged-items (s/coll-of ::ranged-item :min-count 1))
(defmethod payload-type :ranging/succeeded [_]
  (s/keys :req-un [::ranged-items]))

(defn ranging-succeeded [parent-id channel-id channel-name items]
  {:pre [(s/assert uuid? parent-id)
         (s/assert ::channel/id channel-id)
         (s/assert ::channel/name channel-name)
         (s/assert ::ranged-items items)]
   :post [(s/assert ::event %)]}
  (event :ranging/succeeded
         {:ranged-items items}
         :parent-id parent-id
         :channel-id channel-id
         :channel-name channel-name))
```

The final piece left is defining the `tata-cliq` implementation of the `process-ranging` multimethod.

```bash
> touch src/wheel/marketplace/tata_cliq/core.clj
```

```clojure
; src/wheel/marketplace/tata_cliq/core.clj
(ns wheel.marketplace.tata-cliq.core
  (:require [wheel.marketplace.tata-cliq.api :as tata-cliq]
            [wheel.middleware.ranging :as ranging]
            [wheel.oms.message :as oms-message]
            [wheel.middleware.event :as event]
            [clojure.spec.alpha :as s]
            [clojure.set :as set]))

(defmethod ranging/process-ranging :tata-cliq
  [{:keys [channel-name]
    :as   channel-config}
   {:keys [id]
    :as   oms-msg}
   {:keys [channel-id items]
    :as   channel-items}]
  {:pre [(s/assert ::oms-message/oms-message oms-msg)
         (s/assert ::ranging/channel-items channel-items)]}
  (tata-cliq/ranging channel-config channel-id
                     (map #(set/rename-keys % {:id :sku}) items)) ; <1>
  (event/ranging-succeeded id channel-id channel-name items))
```

<span class="callout">1</span> The `item` in `tata-cliq` API doesn't have `id` instead it uses `sku`.


```clojure
; src/wheel/infra/core.clj
(ns wheel.infra.core
  (:require ; ...
            [wheel.marketplace.tata-cliq.core :as tata-cliq]))
; ...
```

### Setting Up Mock Server.

To set up the Mock Server for tata-cliq we are going to use [Mockon](https://mockoon.com). The fake configuration is going to return HTTP Response `200` for the channel-id `UA` and `500` for the channel-id `UB`. This Mockon setup is available in [this gist](https://gist.githubusercontent.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c/raw/d032e1e380ab565fd1f1e1ccf5c03b630b10ab6e/mockon.json). You can import it in the Mockon and start the Mockon server.

With this mock server, if we do a test drive of the implementation, we'll get the following output in the Slack.

```xml
<EXTNChannelList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UC" EAN="EAN_1" ItemID="SKU1" RangeFlag="Y"/>
  </EXTNChannelItemList>
</EXTNChannelList>
```

![](/img/clojure/blog/ecom-middleware/ch-not-found-slack-error.png)

If we try with the channel id `UB`, we'll get the processing failed exception.

```xml
<EXTNChannelList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UB" EAN="EAN_1" ItemID="SKU1" RangeFlag="Y"/>
  </EXTNChannelItemList>
</EXTNChannelList>
```

![](/img/clojure/blog/ecom-middleware/ch-ranging-failed-slack-error.png)

For the channel id `UA`, we'll get the ranging succeeded as expected in the standard output log.

```xml
<EXTNChannelList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UA" EAN="EAN_1" ItemID="SKU1" RangeFlag="Y"/>
  </EXTNChannelItemList>
</EXTNChannelList>
```

```json
{
  "payload": {
    "ranged-items": [
      {
        "ean": "EAN_1",
        "id": "SKU1"
      }
    ],
    "type": "ranging/succeeded"
  },
  "name": "ranging/succeeded",
  "type": "domain",
  "channel-name": "tata-cliq",
  "level": "info",
  "id": "f01e987b-bc72-41e9-9376-b362c3509273",
  "parent-id": "8c22c6c1-9e00-463e-83bb-b2a77ab135a1",
  "channel-id": "UA",
  "timestamp": "2019-10-18T00:19:46.192+05:30"
}
```

### Fixing DB Appender

In the database appender that we added earlier, we need to modify to support all the event types, and we also need to persist the event `payload`. To do it, let's add the database migration script.

```bash
> touch resources/db/migration/V201910180025__alter_event.sql
```

```sql
-- resources/db/migration/V201910180025__alter_event.sql
CREATE TYPE event_type AS ENUM ('domain', 'oms', 'system');

ALTER TABLE event ALTER COLUMN channel_id DROP NOT NULL;
ALTER TABLE event ALTER COLUMN channel_name DROP NOT NULL;
ALTER TABLE event ADD COLUMN type event_type NOT NULL DEFAULT 'domain';
ALTER TABLE event ADD COLUMN payload JSONB NOT NULL DEFAULT '{}';
```

The next step is adding the `event_type` and the `jsonb` type in the Toucan setup and use them in the `event` model definition.

```clojure
; src/wheel/infra/database.clj
(ns wheel.infra.database
  (:require ;...
            [cheshire.core :as json]))
; ...
(defn- to-pg-jsonb [value]
  (doto (PGobject.)
    (.setType "jsonb")
    (.setValue (json/generate-string value))))

(defn- configure-toucan []
  ;...
  (models/add-type! :event-type
                    :in (pg-object-fn "event_type")
                    :out keyword)
  (models/add-type! :jsonb
                    :in to-pg-jsonb
                    :out #(json/parse-string (.getValue %) true)))
```

```clojure
; src/wheel/model/event.clj
; ...
(models/defmodel Event :event
  models/IModel
  (types [_]
         {; ...
          :type         :event-type
          :payload      :jsonb}))
; ...
```

Then rewrite the `create!` event function as below

```clojure
; src/wheel/model/event.clj
; ...
(defn create! [new-event]
  {:pre [(s/assert ::event/event new-event)]}
  (db/insert! Event
              (update new-event :timestamp timestamp->offset-date-time)))
```

Finally, rewrite the `append-to-db` function in the database appender to log all the event types.

```clojure
; src/wheel/infra/log_appender/database.clj
; ...
(defn- append-to-db [{:keys [msg_]}]
  (let [evnt (read-string (force msg_))]
    (event/create! evnt)))
; ...
```

To test these changes, run the migration script and reset the app from the REPL

```clojure
user=> (migrate-database)
{:stopped ["#'wheel.infra.database/datasource"]}
user=> (reset)
{:started [...]}
```

Then put the valid XML ranging message of channel `UA` in IBM-MQ, we should be able to see the new events in the database.

![](/img/clojure/blog/ecom-middleware/appender-db-output.png)

That's it!

## Summary

Thanks for reading the whole article. I believe you'd have got a high-level idea of our project design and implementation. Feel free to drop a comment if you'd like to discuss further!

In the next blog post, we are going to implement the other side of the communication. Marketplace to OMS in which we'll be implementing cron jobs that fetch the information from the marketplace and relay it to the OMS. Stay tuned!

The source code associated with this part is available on [this GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.19/clojure/wheel) repository. 