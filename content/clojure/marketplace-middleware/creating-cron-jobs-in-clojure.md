---
title: "Creating Cron Jobs in Clojure"
date: 2019-10-22T21:34:42+05:30
tags: ["clojure"]
---

In the [last blog post]({{<relref "ranging-items-in-marketplaces.md">}}), we processed the messages from IBM-MQ and relayed the information to the marketplace. In this blog post, we are going to focus on adding cron jobs to our existing infrastructure. The cron jobs pull the data from the marketplace, perform some transformation and send it to the Order Management System(OMS) via IBM-MQ.

> This blog post is a part 8 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).

We will be following the [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/talks/boundaries) technique in this implementation as well by keeping the Cron job infrastructure at the application boundary.

## Leveraging Quartzite

We are going to leverage [Quartzite](http://clojurequartz.info/), scheduling library for Clojure to create and run cron jobs in our project. Quartzite is a Clojure wrapper of Java's [Quartz Job Scheduler](http://www.quartz-scheduler.org/), one of the widely used and feature-rich open-source scheduling tools.

### Initializing the Scheduler

Let's get started by adding the dependency in the *project.clj*

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [clojurewerkz/quartzite "2.1.0"]]
  ; ...
  )
```

Then create a new Clojure file *infra/cron/core.clj* to define a Mount state for the Quartz scheduler.

```bash
> mkdir src/wheel/infra/cron
> touch src/wheel/infra/cron/core.clj
```

```clojure
; src/wheel/infra/cron/core.clj
(ns wheel.infra.cron.core
  (:require [clojurewerkz.quartzite.scheduler :as qs]
            [mount.core :as mount]))

(mount/defstate scheduler
  :start (qs/start (qs/initialize))
  :stop (qs/shutdown scheduler))
```

This Mount state `scheduler` takes care of starting the Quartz scheduler during application bootstrap and shutting it down while closing the application.

### Creating Job

The next step is to implement an abstraction that creates different kinds of Quartz [Jobs](https://www.quartz-scheduler.org/api/2.1.7/org/quartz/Job.html) required for our application.

```bash
> mkdir src/wheel/infra/cron/job
> touch src/wheel/infra/cron/job/core.clj
```

```clojure
; src/wheel/infra/cron/job/core.clj

(ns wheel.infra.cron.job.core
  (:require [clojurewerkz.quartzite.jobs :as qj]))

(defmulti job-type :type)

(defn- identifier [{:keys [channel-id type]}] 
  (str channel-id "/" (name type)))

(defn- create-job [channel-config cron-job-config] 
  (qj/build
   (qj/of-type (job-type cron-job-config))
   (qj/using-job-data {:channel-config  channel-config
                       :cron-job-config cron-job-config})
   (qj/with-identity (qj/key (identifier cron-job-config)))))
```

The `create-job` function takes the configuration of a cron job and its associated channel's configuration as its parameters. 

It builds the Quartz's `Job` instance by getting the `JobType` using the multi-method `job-type`. While creating it passes the configuration parameters to the Job using the [JobDataMap](https://www.quartz-scheduler.org/api/2.1.7/org/quartz/JobDataMap.html).

### Creating A Trigger

The next functionality that we need is to have a function that produces a Quartz [Trigger](https://www.quartz-scheduler.org/api/2.1.7/org/quartz/Trigger.html). Triggers are the 'mechanism' by which Jobs are scheduled.

```clojure
; src/wheel/infra/cron/job/core.clj
(ns wheel.infra.cron.job.core
  (:require ;...
            [clojurewerkz.quartzite.schedule.cron :as qsc]
            [clojurewerkz.quartzite.triggers :as qt]))

; ...
(defn- create-trigger [{:keys [expression]
                        :as   cron-job-config}]
  (qt/build
   (qt/with-identity (qt/key (identifier cron-job-config)))
   (qt/with-schedule (qsc/schedule
                      (qsc/cron-schedule expression)))))
```

The `expression` attribute in the `cron-job-config` holds the [cron expression](http://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html#crontrigger-tutorial). The `create-trigger` function uses it to create and associate a schedule with the trigger.

### Scheduling Jobs For Execution

The final piece that we required is to have a function that takes a `cron-job-config` and schedule a Quartz Job for execution.

```clojure
; src/wheel/infra/cron/job/core.clj
(ns wheel.infra.cron.job.core
  (:require ;...
            [clojurewerkz.quartzite.scheduler :as qs]
            [wheel.infra.config :as config]))

; ...
(defn schedule [scheduler {:keys [channel-id]
                           :as   cron-job-config}]
  (when-let [channel-config (config/get-channel-config channel-id)] ; <1>
    (let [job     (create-job channel-config cron-job-config)
          trigger (create-trigger cron-job-config)]
      (qs/schedule scheduler job trigger)))) ; <2>
```

The final step is to get all the cron job configuration and scheduling it using this `schedule` function during the application bootstrap.

```clojure
; src/wheel/infra/cron/core.clj
(ns wheel.infra.cron.core
  (:require ; ...
            [wheel.infra.cron.job.core :as job]
            [wheel.infra.config :as config]))
; ...
(defn init []
  (for [cron-job-config (config/get-all-cron-jobs)]
    (job/schedule scheduler cron-job-config)))
```

```diff
# src/wheel/infra/core.clj

(ns wheel.infra.core
  (:require ...
+           [wheel.infra.cron.core :as cron]
            ...))

(defn start-app
   ...
-  (mount/start)))
+  (mount/start)
+  (cron/init)))    
```

## Adding Cron Job Configuration

The `config/get-all-cron-jobs` function in the above section is not a part of our application yet. So, let's fix it.

```clojure
; resources/config.edn
{:app      {...
 :settings {:oms       ...
            :channels  ...
            :cron-jobs [{:type       :allocate-order
                         :channel-id "UA"
                         :expression "0 0/1 * 1/1 * ? *"}]}}
```

```clojure
; src/wheel/infra/config.clj
; ...
(defn get-all-cron-jobs []
  (get-in root [:settings :cron-jobs]))
```

> NOTE: In the actual project, we stored the cron job configurations in the Postgres table with some additional attributes like `last-ran-at`, `next-run-at`. I am ignoring that here for brevity.

## Defining Allocate Order Job

One of the vital cron jobs of the middleware is allocating an order. It periodically polls for new orders on a marketplace channel and allocates them in the OMS if any. 

In this blog post, we are going to look at how we processed the new orders from Tata-CliQ. As we did it in the last blog post, we are going to use a fake implementation for their new orders API.

As all the cron jobs are going to pull the channel and cron configuration information from the job context, which we set during during the job creation in the `create-job` function, and invoke a function in the channel, let's create a standard handle function.

```clojure
; src/wheel/infra/cron/job/core.clj
; ...
(ns wheel.infra.cron.job.core
  (:require ; ...
            [clojurewerkz.quartzite.conversion :as qc]))

(defn handle [channel-fn ctx]
  (let [{:strs [channel-config cron-job-config]} (qc/from-job-data ctx)
        {:keys [channel-id]}                     cron-job-config
        {:keys [channel-name]}                   channel-config]
      (channel-fn channel-id channel-config)))
```

Then use this `handle` function to define the `AllocateOrder` job.

```batch
> touch src/wheel/infra/cron/job/allocate_order.clj
```

```clojure
; src/wheel/infra/cron/job/allocate_order.clj
(ns wheel.infra.cron.job.allocate-order
  (:require [wheel.infra.cron.job.core :as job]
            [clojurewerkz.quartzite.jobs :as qj]
            [wheel.marketplace.channel :as channel]))

(qj/defjob AllocateOrderJob [ctx]
  (job/handle channel/allocate-order ctx))

(defmethod job/job-type :allocate-order [_]
  AllocateOrderJob)
```

The higher-order function `channel/allocate-order` that we pass here to the `handle` function is a multi-method that takes care of the allocating order from different marketplace channels. It is also not defined yet. So, let's add it as well. 

```clojure
; src/wheel/marketplace/channel.clj
; ...

(defmulti allocate-order (fn [channel-id channel-config]
                           (:channel-name channel-config)))
```

## Unified Order Data Model

The fake implementation of the tata-cliq's new orders API returns an XML response similar to this 

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Orders>
  <Order>
    <OrderNo>181219-001-345786</OrderNo>
    <AddressInfo>
      <Shipping>
        <FirstName>Tamizhvendan</FirstName>
        <LastName>Sembiyan</LastName>
        <Address1>Plot No 222</Address1>
        <Address2>Ashok Nagar 42nd Street</Address2>
        <City>Chennai</City>
        <State>TamilNadu</State>
        <Pincode>600001</Pincode>
      </Shipping>
      <Billing>
        <FirstName>Tamizhvendan</FirstName>
        <LastName>Sembiyan</LastName>
        <Address1>Plot No 222</Address1>
        <Address2>Ashok Nagar 42nd Street</Address2>
        <City>Chennai</City>
        <State>TamilNadu</State>
        <Pincode>600001</Pincode>
      </Billing>
    </AddressInfo>
    <PaymentInfo>
      <PaymentCost>900.0</PaymentCost>
      <PaymentId>000000-1545216772601</PaymentId>
    </PaymentInfo>
    <OrderLines>
      <OrderLine>
        <TransactionId>200058001702351</TransactionId>
        <ArticleNumber>200374</ArticleNumber>
        <Price>900.0</Price>
      </OrderLine>
    </OrderLines>
  </Order>
</Orders>
```

Our objective is to convert this into another XML format (like below) and send it to OMS via IBM-MQ. 

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Order OrderNo="181219-001-345786">
  <PersonInfoBillTo City="Chennai" FirstName="Tamizhvendan" LastName="Sembiyan" State="TamilNadu" ZipCode="600001">
    <Extn IRLAddressLine1="Plot No 222" IRLAddressLine2="Ashok Nagar 42nd Street" />
  </PersonInfoBillTo>
  <PersonInfoShipTo City="Chennai" FirstName="Tamizhvendan" LastName="Sembiyan" State="TamilNadu" ZipCode="600001">
    <Extn IRLAddressLine1="Plot No 222" IRLAddressLine2="Ashok Nagar 42nd Street" />
  </PersonInfoShipTo>
  <PaymentDetailsList>
    <PaymentDetails ProcessedAmount="900.0" Reference1="000000-1545216772601"/>
  </PaymentDetailsList>
  <OrderLines>
    <OrderLine>
      <Item ItemID="200374"/>
      <LinePriceInfo LineTotal="900.0"/>
    </OrderLine>
  </OrderLines>
</Order>
```

To perform this, we are going to have a unified data model for representing an OMS order, and each marketplace has its logic to convert its data model into OMS's data model of the order.

The standard data model would look like this for the above XML data. 

```clojure
{:order-no "181219-001-345786"
 :payments [{:amount 900 :reference-id "000000-1545216772601"}]
 :order-lines [{:id "200374" :sale-price 900}]
 :billing-address {:first-name "Tamizhvendan"
                   :last-name "Sembiyan"
                   :line1 "Plot No 222"
                   :line2 "Ashok Nagar 42nd Street"
                   :city "Chennai"
                   :state "TamilNadu"
                   :pincode 600001}
 :shipping-address {:first-name "Tamizhvendan"
                    :last-name "Sembiyan"
                    :line1 "Plot No 222"
                    :line2 "Ashok Nagar 42nd Street"
                    :city "Chennai"
                    :state "TamilNadu"
                    :pincode 600001}}
```

As a first step let's define a spec for this 

```batch
> touch src/wheel/string.clj
> touch src/wheel/oms/address.clj
> touch src/wheel/oms/payment.clj
> touch src/wheel/oms/order_line.clj
> touch src/wheel/oms/order.clj
```

```clojure
; src/wheel/string.clj
(ns wheel.string
  (:require [clojure.string :as str]))

(defn not-blank? [s]
  (and (string? s) (not (str/blank? s))))
```

```clojure
; src/wheel/oms/address.clj
(ns wheel.oms.address
  (:require [clojure.spec.alpha :as s]
            [wheel.string :as w-str]))

(s/def ::first-name w-str/not-blank?)
(s/def ::last-name w-str/not-blank?)
(s/def ::line1 w-str/not-blank?)
(s/def ::line2 w-str/not-blank?)
(s/def ::city w-str/not-blank?)
(s/def ::state w-str/not-blank?)
(s/def ::pincode (s/int-in 110001 855118))

(s/def ::address (s/keys :req-un [::first-name ::line1 ::city ::state ::pincode]
                          :opt-un [::last-name ::line2]))
```

```clojure
; src/wheel/oms/payment.clj
(ns wheel.oms.payment
  (:require [clojure.spec.alpha :as s]
            [wheel.string :as w-str]))

(s/def ::amount (s/and decimal? pos?))
(s/def ::reference-id w-str/not-blank?)

(s/def ::payment (s/keys :req-un [::amount ::reference-id]))
```

```clojure
; src/wheel/oms/order_line.clj
(ns wheel.oms.order-line
  (:require [wheel.oms.item :as item]
            [clojure.spec.alpha :as s]))

(s/def ::sale-price (s/and decimal? pos?))

(s/def ::order-line (s/keys :req-un [::item/id ::sale-price]))
```

```clojure
; src/wheel/oms/order.clj
(ns wheel.oms.order
  (:require [clojure.spec.alpha :as s]
            [wheel.oms.address :as addr]
            [wheel.oms.payment :as payment]
            [wheel.oms.order-line :as order-line]
            [wheel.string :as w-str]))

(s/def ::order-no w-str/not-blank?)
(s/def ::payments 
  (s/coll-of ::payment/payment :min-count 1))
(s/def ::order-lines 
  (s/coll-of ::order-line/order-line :min-count 1))
(s/def ::billing-address ::addr/address)
(s/def ::shipping-address ::addr/address)
(s/def ::order 
  (s/keys :req-un [::order-no ::shipping-address 
                   ::billing-address ::payments
                   ::order-lines]))
```

The next step is to add a function that takes an order that conforms to the above spec and transforms it into its XML version.

We are going to make use of [data.xml](https://github.com/clojure/data.xml) library that allows the dynamic creation of XML content from Clojure data structures via [Hiccup-like](https://github.com/weavejester/hiccup) style.

```clojure
; project.clj
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [org.clojure/data.xml "0.0.8"]]
  ; ...
  )

```clojure
; src/wheel/oms/order.clj
(ns wheel.oms.order
  (:require ; ...
            [clojure.data.xml :as xml]))
; ...
(defn address-to-xml [{:keys [first-name last-name line1
                              line2 city state pincode]}]
  {:attrs {:FirstName first-name
           :LastName last-name
           :State state
           :City city
           :Pincode pincode}
   :ext [:Extn {:IRLAddressLine1 line1
                :IRLAddressLine2 line2}]})

(defn to-xml [order]
  {:pre [(s/assert ::order order)]}
  (let [{:keys [order-no billing-address order-lines 
                shipping-address payments]} order
        {bill-to-attrs :attrs
         bill-to-ext :ext} (address-to-xml billing-address)
        {ship-to-attrs :attrs
         ship-to-ext :ext} (address-to-xml shipping-address)]
    (-> [:Order {:OrderNo order-no}
         [:PersonInfoBillTo bill-to-attrs bill-to-ext]
         [:PersonInfoShipTo ship-to-attrs ship-to-ext]
         [:PaymentDetailsList 
          (map (fn [{:keys [amount reference-id]}]
                 [:PaymentDetails {:ProcessedAmount amount
                                   :Reference1 reference-id}]) payments)]
         [:OrderLines
          (map (fn [{:keys [id sale-price]}]
                 [:OrderLine 
                  [:Item {:ItemID id}]
                  [:LinePriceInfo {:LineTotal sale-price}]])
               order-lines)]]
        xml/sexp-as-element
        xml/indent-str)))
```

## Sending Message to OMS via IBM-MQ

The next step is sending the transformed order information to IBM-MQ. To enable it, let's add a [JMS producer](https://docs.oracle.com/javaee/7/api/javax/jms/MessageProducer.html) for order allocation in *infra/oms.clj*.

```clojure
; src/wheel/infra/oms.clj

(mount/defstate order-allocating-session
  :start (.createSession ibmmq/jms-conn false Session/AUTO_ACKNOWLEDGE)
  :stop (stop order-allocating-session))

(mount/defstate order-allocating-producer
  :start (let [queue-name       (:order-allocating-queue-name (config/oms-settings))
               ibmmq-queue-name (str "queue:///" queue-name)
               destination      (.createQueue order-allocating-session ibmmq-queue-name)]
           (.createProducer order-allocating-session destination))
  :stop (stop order-allocating-producer))
```

Then define an OMS client that abstracts the communication to OMS.

```clojure
> touch src/wheel/oms/client.clj
```

```clojure
(ns wheel.oms.client
  (:require [wheel.oms.order :as oms-order]
            [wheel.infra.oms :as oms-infra]
            [clojure.spec.alpha :as s]))

(defn- send [session producer xml-message]
  (let [msg (.createTextMessage session)]
    (.setText msg xml-message)
    (.send producer msg)))

(defn allocate-order [order]
  {:pre [(s/assert ::oms-order/order order)]}
  (send oms-infra/order-allocating-session
        oms-infra/order-allocating-producer
        (oms-order/to-xml order)))
```

## Adding New Orders API

Let's switch our attention to the Tata-CliQ API side that is going to fetch the new orders from their site for the given channel id. The [Mockon](https://mockoon.com) configuration for the fake server is available in [this gist](https://gist.github.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c#file-mockon-json). 

```clojure
; src/wheel/marketplace/tata_cliq/api.clj
(ns wheel.marketplace.tata-cliq.api
  (:require ; ...
            [wheel.marketplace.tata-cliq.order :as tata-cliq-order])
; ...

(defn new-orders [{:keys [base-url bearer-token]} channel-id]
  (let [url         (str base-url "/channels/" channel-id "/new-orders")
        auth-header (str "Bearer " bearer-token)]
    (-> (http/get url {:headers {:authorization auth-header}})
        :body
        tata-cliq-order/parse-new-orders)))
```

The `tata-cliq-order/parse-new-orders` function takes an XML response and transforms it into a tata-cliq's order data model.

> As it is so domain-specific, I am not going to share it here and you can refer to [this implementation](https://github.com/demystifyfp/BlogSamples/blob/0.20/clojure/wheel/src/wheel/marketplace/tata_cliq/order.clj). This implementation uses a custom [XML to Clojure map](https://github.com/demystifyfp/BlogSamples/blob/0.20/clojure/wheel/src/wheel/xml.clj) conversion implementation

```clojure
; src/wheel/marketplace/tata_cliq/order.clj
(ns wheel.marketplace.tata-cliq.order
  (:require ; ...
            ))

(defn parse-new-orders [xml-response]
  ; ... 
  )

(defn to-oms-order [tata-cliq-order]
  ; ... 
  )
```

As the name indicates the `to-oms-order` function takes a tata-cliq's order and transforms it to OMS's order representation.

## Wiring Up With The Cron Job

The final piece is wiring up the allocate order cron job for the Tata-Cliq API. It fetches the new orders, tranforms each order to its corresponding OMS representation and allocates them in the OMS.

```clojure
(ns wheel.marketplace.tata-cliq.core
  (:require ; ...
            [wheel.marketplace.tata-cliq.order :as tata-cliq-order]
            [wheel.oms.client :as oms]
            [wheel.marketplace.channel :as channel])
; ...
(defmethod channel/allocate-order :tata-cliq 
  [channel-id channel-config]
  (->> (tata-cliq/new-orders channel-config channel-id)
       (map tata-cliq-order/to-oms-order)
       (run! oms/allocate-order)))
```

## Logging Cron Activities.

Thanks to our existing logging infrastructure, logging cron job started and failed information would be easy to add.

```diff
# src/wheel/infra/cron/job/core.clj
# ...
(ns wheel.infra.cron.job.core
  (:require # ...
+           [wheel.middleware.event :as event]  
            ))

(defn handle [channel-fn ctx]
  (let [ # ...
+        cron-started-event (event/cron type channel-id channel-name) 
         # ...]
-    (channel-fn channel-id channel-config))
+    (try
+       (channel-fn channel-id channel-config)
+       (log/write! cron-started-event)
+       (catch Throwable ex
+         (log/write-all! [cron-started-event
+                          (event/cron type channel-id channel-name ex)]))))
```

```clojure
; src/wheel/middleware/event.clj
; ...
(s/def ::system-event-name #{; ...
                             :system.cron/started
                             :system.cron/failed})

(s/def ::job-type #{:allocate-order})
; ...
(defmethod payload-type :system.cron/started [_]
  (s/keys :req-un [::job-type]))

(defmethod payload-type :system.cron/failed [_]
  (s/keys :req-un [::job-type ::error-message ::stacktrace]))

(defn cron 
  ([job-type channel-id channel-name]
   (event :system.cron/started {:job-type job-type}
          :channel-id channel-id
          :channel-name channel-name
          :type :system
          :level :info))
  ([job-type channel-id channel-name ex]
   (event :system.cron/failed
          (assoc (ex->map ex) :job-type job-type)
          :channel-id channel-id
          :channel-name channel-name
          :type :system
          :level :error)))
```

If we stop the fake API server for a moment, we will get the cron-job notification in the slack when the cron job got triggered.

![](/img/clojure/blog/ecom-middleware/cron-job-failed-notification.png)

## Summary

In this blog post, we learnt how to implement cron jobs in Clojure. With this, we are wrapping up the business requirement implementations of the sample app, Wheel. In the upcoming blog posts, I'll be touching upon how we went with the testing and also reflecting on the design of the overall design of the system. 

The source code associated with this part is available on [this GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.20/clojure/wheel) repository. 