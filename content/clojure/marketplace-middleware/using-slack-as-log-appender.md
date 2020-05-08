---
title: "Using Slack as Log Appender"
date: 2019-10-06T20:25:41+05:30
tags: ["clojure", "Timbre"]
---

The back-office team of our client has an active slack based workflow for most of their systems. As this middleware is going to be another system that they need to keep track of, they asked us to send messages on Slack if the middleware encounters an error during its operation. In this blog post, I am going to share how we did it in Clojure using Timbre.

> This blog post is a part 5 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).

### Slack Incoming Webhooks

Slack has the mechanism of [Incoming Webhooks](https://api.slack.com/incoming-webhooks) that provides a simple way to post messages from any application into Slack. By following [these steps](https://api.slack.com/incoming-webhooks#getting-started), we will get a unique *webhook* URL to which we can send a JSON payload with the message text and some other options.

### Sending A Slack Message

To work with the HTTP post requests, let's add [clj-http](https://github.com/dakrone/clj-http) dependency in our *project.clj* and restart the REPL.

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [clj-http "3.10.0"]]
  ; ...
  )
```

Then create a new directory *slack* and a Clojure file *webhook.clj* under it.

```bash
> mkdir src/wheel/slack
> touch src/wheel/slack/webhook.clj
```

Finally, create a function `post-message!` to post a message in a Slack channel using the webhook URL.

```clojure
; src/wheel/slack/webhook.clj
(ns wheel.slack.webhook
  (:require [clj-http.client :as http]
            [cheshire.core :as json]))

(defn post-message! [webhook-url text attachments]
  (let [body (json/generate-string {:text text
                                    :attachments attachments})]
    (http/post webhook-url {:content-type :json
                            :body body})))
```

Let's try to execute this function in the REPL

```clojure
wheel.slack.webhook=> (post-message! "{{webhook-url}}"
                                     "ranging failed"
                                     [{:color :danger
                                       :fields [{:title "Channel Name"
                                                 :value :tata-cliq
                                                 :short true}
                                                {:title "Channel Id"
                                                 :value "UA"
                                                 :short true}
                                                {:title "Event Id"
                                                 :value "2f763cf7-d5d7-492c-a72d-4546bb547696"}]}])
{:body "ok"
 ; ...
 }
```

We should see something similar to this in the configured slack channel.

![](/img/clojure/blog/ecom-middleware/sample-slack-event.png)

### Updating Application Config

To pass the slack's webhook URL to the application, let's update the *resources/config.edn*.

```clojure
{:app
  {:database {...}
   :log {:slack {:webhook-url #env "WHEEL_APP_LOG_SLACK_WEBHOOK_URL"}}}}
```

Then add the wrapper function in the *infra/config.clj*

```clojure
; src/wheel/infra/config.clj
; ...
(defn slack-log-webhook-url []
  (get-in root [:app :log :slack :webhook-url]))
```

To verify this new config, stop the REPL, set the environment variable `WHEEL_APP_LOG_SLACK_WEBHOOK_URL` with the webhook URL and start the REPL. Then start the app, call the `slack-log-webhook-url` function.

```clojure
wheel.core=> (in-ns 'user)
#<clojure.lang.Namespace@13250e3 user>
user=> (start-app)
{:started [...]}
user=> (wheel.infra.config/slack-log-webhook-url)
"https://hooks.slack.com/services/...."
```

All right! Now we have the infrastructure in place to send messages to Slack, and it's time to wire it up with Timbre.

### Adding Slack Appender

As we did for the `database` appender, let's create a new file *slack.clj* under *infra/log_appender*

```bash
> touch src/infra/log_appender/slack.clj
```

Then add two helper function to transform the events into slack text and attachment.

```clojure
; src/infra/log_appender/slack.clj
(ns wheel.infra.log-appender.slack
  (:require [wheel.slack.webhook :as slack]
            [wheel.infra.config :as config]))

(defn- event->text [{event-name :name}]
  (str (namespace event-name) " " (name event-name)))

(defn- event->attachment [{:keys [id channel-id channel-name]}]
  {:color :danger
   :fields [{:title "Channel Name"
             :value channel-name
             :short true}
            {:title "Channel Id"
             :value channel-id
             :short true}
            {:title "Event Id"
             :value id}]})
```

```clojure
wheel.infra.log-appender.slack==> (event->text {:name :ranging/failed})
"ranging failed"
```

The actual appender function uses these functions and posts the message using the `post-message!` function that we defined earlier.

```clojure
; src/infra/log_appender/slack.clj
; ...

(defn- send-to-slack [{:keys [msg_]}]
  (let [event (read-string (force msg_))]
    (when (= :domain (:type event))
      (let [text (event->text event)
            attachment (event->attachment event)
            webhook-url (config/slack-log-webhook-url)]
        (slack/post-message! webhook-url text [attachment])))))

(def appender {:enabled? true
               :output-fn :inherit
               :async? true
               :min-level :error
               :fn send-to-slack})
```

Unlike the `database` appender, the `slack` one going to process only the logs with the level `:error` or above.

The final step is adding this appender to the Timbre's config.

```clojure
(ns wheel.infra.log
  (:require ; ...
            [wheel.infra.log-appender.slack :as slack]))

; ...

(defn init []
  (timbre/merge-config! {; ...
                         :appenders { ;...
                                     :slack slack/appender}}))

; ...
```

If we reset the application in the REPL, and write an error log using the `write!` function, we should be able to see the log entry (event) both in the slack and in the database.


## Summary

In this blog post, we started from where we left off in the previous post and added the new `slack` appender. Working with Timber for logging is such a pleasant experience. We are one more step closer in setting up the infrastructure aspects of the application. Stay tuned!

The source code associated with this part is available on [this GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.17/clojure/wheel) repository.