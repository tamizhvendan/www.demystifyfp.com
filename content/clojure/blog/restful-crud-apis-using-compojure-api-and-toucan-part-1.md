---
title: "RESTful CRUD APIs Using Compojure-API and Toucan (Part-1)"
date: 2018-10-12T19:39:17+05:30
tags: ["clojure", "compojure-api", "toucan"]
---

Hi,

In my [last blog post]({{<relref "clojure-in-production.md">}}) on our experiences in using Clojure in production, I mentioned that we used [Compojure API](https://github.com/metosin/compojure-api) and [Toucan](https://github.com/metabase/toucan) to implement CRUD APIs. The abstraction that we created using these libraries helped us to create HTTP CRUD APIs for any domain entity in a matter of minutes. In this small blog-post series, I am going to share how we did it.

This first part is going to focus on developing a RESTful CRUD APIs for a specific domain entity. In the next part, we are going to generalize the implementation to make it extendable for other domain entities. 

## Project Setup

In this blog post, we are going to develop the CRUD APIs for domain entity `user` with PostgreSQL as the database. 

Let's create a new Clojure project using [Leiningen](https://leiningen.org/).

```bash
> lein new app resultful-crud
```

And then add the following dependencies in *project.clj*.

```clj
(defproject resultful-crud "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [[org.clojure/clojure "1.9.0"]

                 ; Web
                 [prismatic/schema "1.1.9"]
                 [metosin/compojure-api "2.0.0-alpha26"]
                 [ring/ring-jetty-adapter "1.6.3"]

                 ; Database
                 [toucan "1.1.9"]
                 [org.postgresql/postgresql "42.2.4"]

                 ; Password Hashing
                 [buddy/buddy-hashers "1.3.0"]]
  ; ...
  )
```

To keep things simple, we are going to create the database and create the table directly using `psql` instead of using database migration utilities like [Flyway](https://flywaydb.org/).

```bash
> createdb restful-crud

> psql -d restful-crud

restful-crud:> CREATE TABLE "user" (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
              );
CREATE TABLE

restful-crud:>
```

## Initialising Toucan

Toucan requires us to provide two information to initialise itself

* A database connection specification.
* Toucan requires that all models live in specific predictable namespaces and we have to provide the [root namespace](https://github.com/metabase/toucan/blob/master/docs/setup.md#configuring-the-root-model-namespace) where it can find the models.

The right place to do this configuration is during application bootstrap.

```clojure
; src/restful_crud/core.clj
(ns resultful-crud.core
  (:require [toucan.db :as db]
            [toucan.models :as models])
  (:gen-class))

(def db-spec
  {:dbtype "postgres"
   :dbname "restful-crud"
   :user "postgres"
   :password "postgres"})

(defn -main
  [& args]
  (db/set-default-db-connection! db-spec)
  (models/set-root-namespace! 'resultful-crud.models))
```

### Adding The User Model

Then create a new folder *models* in *src/restful_crud* directory and add a new file *user.clj*

```clojure
; src/restful_crud/models/user.clj
(ns resultful-crud.models.user
  (:require [toucan.models :refer [defmodel]]))

(defmodel User :user)
```

The keyword `:user` represents the table name.

## Creating Schema For UserRequest

Compojure-api supports [pluggable coercion](https://github.com/metosin/compojure-api/wiki/Coercion) with out-of-the-box implementations for [Schema](https://github.com/plumatic/schema) and [clojure.spec](https://clojure.org/guides/spec). In this series, we are going to use *Schema*.

Here are the constraints that we have for the domain entity. 

* `username` should not contain more than 50 characters, and it shouldn't be empty
* `email` should be a valid email address
* `password` should contain at least five characters and not more than 50 characters.  

To incorporate this check, let's add some utility functions. 

```clojure
; src/restful_crud/string_util.clj

(ns resultful-crud.string-util
  (:require [clojure.string :as str]))

(def non-blank? (complement str/blank?))

(defn max-length? [length text]
  (<= (count text) length))

(defn non-blank-with-max-length? [length text]
  (and (non-blank? text) (max-length? length text)))

(defn min-length? [length text]
  (>= (count text) length))

(defn length-in-range? [min-length max-length text]
  (and (min-length? min-length text) (max-length? max-length text)))

(def email-regex
  #"(?i)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?")

(defn email? [email]
  (boolean (and (string? email) (re-matches email-regex email))))  
```

And then use these functions to define a schema for `UserRequest`

```clojure
; cat src/restful_crud/user.clj
(ns resultful-crud.user
  (:require [schema.core :as s]
            [resultful-crud.string-util :as str]))

(defn valid-username? [name]
  (str/non-blank-with-max-length? 50 name))

(defn valid-password? [password]
  (str/length-in-range? 5 50 password))

(s/defschema UserRequestSchema
  {:username (s/constrained s/Str valid-username?)
   :password (s/constrained s/Str valid-password?)
   :email (s/constrained s/Str str/email?)})
```

## User Create API

Now we have a Schema for the user, and it is time to create our first API for creating a new user. 

Let's start this by adding a handler function that takes a create user request and persist it in the database using Toucan.

```clojure
; cat src/restful_crud/user.clj
(ns resultful-crud.user
  (:require ; ...
            [resultful-crud.models.user :refer [User]]
            [buddy.hashers :as hashers]
            [clojure.set :refer [rename-keys]]
            [toucan.db :as db]
            [ring.util.http-response :refer [created]]))
; ...

(defn id->created [id]
  (created (str "/users/" id) {:id id}))

(defn canonicalize-user-req [user-req]
  (-> (update user-req :password hashers/derive)
      (rename-keys {:password :password_hash})))

(defn create-user-handler [create-user-req]
  (->> (canonicalize-user-req create-user-req)
       (db/insert! User)
       :id
       id->created))
```

The `create-user-handler` function takes a `create-user-req` a coerced version of below JSON and does the following 

* Canonicalize the request by hashing the password, the rename the key `password` with `password_hash` (to match the column name in the database)
* Insert into the table using Toucan's `insert!` function
* Takes the `id` of the new user returned by Toucan and returns the ring's `created` HTTP response

```json
{
  "username" : "foobar",
  "password" : "barfoo",
  "email" : "foobar@example.com"
}
``` 

The next step is wiring up this handler with a Compojure-api route.

```clojure
; cat src/restful_crud/user.clj
(ns resultful-crud.user
  (:require ; ...
            [compojure.api.sweet :refer [POST]]))
; ...

(def user-routes
  [(POST "/users" []
     :body [create-user-req UserRequestSchema]
     (create-user-handler create-user-req))])
```

Finally, using the `ring-jetty` adapter, we are going to expose this route as an HTTP API

```clojure
; cat src/restful_crud/core.clj
(ns resultful-crud.core
  (:require ; ...
            [ring.adapter.jetty :refer [run-jetty]]
            [compojure.api.sweet :refer [routes]]
            [resultful-crud.user :refer [user-routes]]))
; ...

(def app (apply routes user-routes))

(defn -main
  [& args]
  ; ...
  (run-jetty app {:port 3000}))
```

## Get User API

The next API is getting a user by his/her `id`. As we did earlier, create a handler for getting a user by id and wire it up in a route.

```clojure
; cat src/restful_crud/user.clj
(ns resultful-crud.user
  (:require ; ...
            [compojure.api.sweet :refer [POST GET]]
            [ring.util.http-response :refer [created ok not-found]]))
; ...

(defn user->response [user]
  (if user
    (ok user)
    (not-found)))

(defn get-user-handler [user-id]
  (-> (User user-id)
      (dissoc :password_hash)
      user->response))

(def user-routes
  [ ; ...
    (GET "/users/:id" []
     :path-params [id :- s/Int]
     (get-user-handler id))])
```

We can repeat the similar approach for the other APIs as below.

## Get Users API

```clojure
; cat src/restful_crud/user.clj
; ...
(defn get-users-handler []
  (->> (db/select User)
       (map #(dissoc % :password_hash))
       ok))

(def user-routes
  [ ; ...
    (GET "/users" []
     (get-users-handler))])
```

## Update User API

```clojure
; cat src/restful_crud/user.clj
(ns resultful-crud.user
  (:require ; ...
            [compojure.api.sweet :refer [POST GET PUT]]))
; ...

(defn update-user-handler [id update-user-req]
  (db/update! User id (canonicalize-user-req update-user-req))
  (ok))

(def user-routes
  [ ; ...
    (PUT "/users/:id" []
      :path-params [id :- s/Int]
      :body [update-user-req UserRequestSchema]
      (update-user-handler id update-user-req))])
```

## Delete User API

```clojure
; cat src/restful_crud/user.clj
(ns resultful-crud.user
  (:require ; ...
            [compojure.api.sweet :refer [POST GET PUT DELETE]]))
; ...

(defn delete-user-handler [user-id]
  (db/delete! User :id user-id)
  (ok))

(def user-routes
  [ ; ...
    (DELETE "/users/:id" []
     :path-params [id :- s/Int]
     (delete-user-handler id))])
```

## Exposing Swagger UI

Compojure API offers Swagger integration out of the box. To wire it up we just need to wrap the app with `api` function with a swagger configuration.

```clojure
; cat src/restful_crud/core.clj
(ns resultful-crud.core
  (:require ; ...
            [compojure.api.sweet :refer [api routes]]))
; ...

(def swagger-config
  {:ui "/swagger"
   :spec "/swagger.json"
   :options {:ui {:validatorUrl nil}
             :data {:info {:version "1.0.0", :title "Restful CRUD API"}}}})

; (def app (apply routes user-routes))
(def app (api {:swagger swagger-config} (apply routes user-routes)))

; ...
```

Now if we run the application, we can access the Swagger UI on http://localhost:3000/swagger

![](/img/clojure/blog/restful/restful_user_swagger_ui.png)

## Summary 

In this blog post, we have seen how to implement a RESTful CRUD APIs in Clojure using Compojure-Api & Toucan. 

The code that we have in place for the exposing the `user` endpoints can be generalised so that other domain entities can be exposed without repeating the similar pattern. 

We will see this in the next part of this blog post series! Stay Tuned!!

> The sample code is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.10/clojure/resultful-crud).