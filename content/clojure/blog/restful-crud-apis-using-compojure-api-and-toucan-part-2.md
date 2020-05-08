---
title: "RESTful CRUD APIs Using Compojure-API and Toucan (Part-2)"
date: 2018-10-18T01:17:17+05:30
tags: ["clojure", "compojure-api", "toucan"]
---

Hi,

In the [last blog post]({{<relref "restful-crud-apis-using-compojure-api-and-toucan-part-1.md">}}), we learned how to implement RESTful APIs using Compojure-API & Toucan. We are going to generalise that example by creating a little abstraction around it. 

The abstraction that we are going to create is going to help us in creating similar RESTful endpoints for any domain entities with less code. 

Let's dive in!

## The Book Entity
To abstract what we did there, we need a few more specific implementation. So, let's repeat what we did there with another entity called "Book".

```bash
> psql -d restful-crud

restful-crud:> CREATE TABLE book (
                id SERIAL PRIMARY KEY,
                title VARCHAR(100) NOT NULL,
                year_published INTEGER NOT NULL
              );
CREATE TABLE

restful-crud:>
```

The next step after creating a `book` table is to create a [Toucan model](https://github.com/metabase/toucan/blob/master/docs/defining-models.md).

```clojure
; src/restful_crud/models/book.clj
(ns resultful-crud.models.book
  (:require [toucan.models :refer [defmodel]]))

(defmodel Book :book)
```

Then create the schema for `Book`.

```clojure
; src/restful_crud/book.clj
(ns resultful-crud.book
  (:require [schema.core :as s]
            [resultful-crud.string-util :as str]))

(defn valid-book-title? [title]
  (str/non-blank-with-max-length? 100 title))

(defn valid-year-published? [year]
  (<= 2000 year 2018))

(s/defschema BookRequestSchema
  {:title (s/constrained s/Str valid-book-title?)
   :year_published (s/constrained s/Int valid-year-published?)})
```

To expose the CRUD APIs let's repeat what we did for `User`.

```clojure
; src/restful_crud/book.clj
(ns resultful-crud.book
  (:require ; ...
            [resultful-crud.models.book :refer [Book]]
            [toucan.db :as db]
            [ring.util.http-response :refer [ok not-found created]]
            [compojure.api.sweet :refer [GET POST PUT DELETE]]))

;; Create
(defn id->created [id]
  (created (str "/books/" id) {:id id}))

(defn create-book-handler [create-book-req]
  (-> (db/insert! Book create-book-req)
      :id
      id->created))

;; Get All
(defn get-books-handler []
  (ok (db/select Book)))

;; Get By Id
(defn book->response [book]
  (if book
    (ok book)
    (not-found)))

(defn get-book-handler [book-id]
  (-> (Book book-id)
      book->response))

;; Update
(defn update-book-handler [id update-book-req]
  (db/update! Book id update-book-req)
  (ok))

;; Delete
(defn delete-book-handler [book-id]
  (db/delete! Book :id book-id)
  (ok))

;; Routes
(def book-routes
  [(POST "/books" []
     :body [create-book-req BookRequestSchema]
     (create-book-handler create-book-req))
   (GET "/books" []
     (get-books-handler))
   (GET "/books/:id" []
     :path-params [id :- s/Int]
     (get-book-handler id))
   (PUT "/books/:id" []
     :path-params [id :- s/Int]
     :body [update-book-req BookRequestSchema]
     (update-book-handler id update-book-req))
   (DELETE "/books/:id" []
     :path-params [id :- s/Int]
     (delete-book-handler id))])
```

The last step is exposing these routes as HTTP endpoints.

```diff
; src/restful_crud/core.clj
(ns resultful-crud.core
  (:require 
+           [resultful-crud.book :refer [book-routes]]))
...
(def app (api {:swagger swagger-config} 
-             (apply routes user-routes)))
+             (apply routes (concat user-routes book-routes))))
```

## The RESTful Abstraction

If we have a closer look at the routes & handlers of the CRUD operations of `Book` & `User`, there are many similarities that we can generalise so that we don't need to repeat the same for the other entities that we'll be adding in the system. 

### Create Handler
Let's start from `create` handler & route.

![](/img/clojure/blog/restful/create-api.png)

As we can see from the diagram, other than canonicalising the create request all the other things are similar across two implementations. We can view this implementation like a pipeline.

![](/img/clojure/blog/restful/create-pipeline.png) **-represents entity*

We can take inspiration from Pedestal's [interceptor](http://pedestal.io/reference/interceptors), and model the *pre-insert-hook* as `enter`.

The abstracted version of `create` would look like

```clojure
; src/restful_crud/restful.clj
(ns restful-crud.restful
  (:require [compojure.api.sweet :refer [POST]]
            [toucan.db :as db]
            [ring.util.http-response :refer [created]]))

(defn id->created [name id]
  (created (str "/" name "/" id) {:id id}))

(defn create-route [{:keys [name model req-schema enter]}] ;<1>
  (let [enter-interceptor (or enter identity) ;<2>
        path (str "/" name)]
    (POST path http-req
      :body [req-body req-schema]
      (->> (enter-interceptor req-body) ;<3>
           (db/insert! model)
           :id
           (id->created name)))))
```

<1> All the required parameters are received as a `map` and destructured [using the `:keys` keyword](https://gist.github.com/john2x/e1dca953548bfdfb9844#shortcuts)

<2> As `enter` interceptor is optional, we are using the `identity` function as a replacement if the `enter` interceptor doesn't exist. 

<3> In the request processing pipeline, we are transforming the incoming `req-body` using the `enter-interceptor`. Rest of the code is similar to our concrete implementation except that the actual domain entity related aspects are parameterised. 

### Get By Id Handler

The `get-by-id` handlers of `user` & `book` differ on what we do after we fetch it from the database.  
![](/img/clojure/blog/restful/get-by-id-api.png)
As depicted in the image, in `get-user-handler` we `dissoc` the `password_hash` from the `user` instance.
Again this can be viewed as a pipeline, where need a hook to transform the instance retrieved from the database.
![](/img/clojure/blog/restful/get-by-id-pipeline.png)

This `post-fetch-hook` can be viewed as a `leave` interceptor and implemented as below.

```clojure
; src/restful_crud/restful.clj
(ns restful-crud.restful
  (:require ; ...
            [schema.core :as s]
            [compojure.api.sweet :refer [... GET]]
            [ring.util.http-response :refer [... ok]]))
; ...

(defn resource-id-path [name]
  (str "/" name "/:id"))

(defn entity->response [entity]
  (if entity (ok entity) (not-found)))

(defn get-by-id-route [{:keys [name model leave]}]
  (let [leave-interceptor (or leave identity)
        path (resource-id-path name)]
    (GET path []
      :path-params [id :- s/Int]
      (-> (model id)
          leave-interceptor
          entity->response))))
```

We can do the same for other handlers as below.

### Get All Handler

```clojure
; src/restful_crud/restful.clj
; ...

(defn get-all-route [{:keys [name model leave]}]
  (let [leave-interceptor (or leave identity)
        path (str "/" name)]
    (GET path []
      (->> (db/select model)
           (map leave-interceptor)
           ok))))
```

### Update Handler
```clojure
; src/restful_crud/restful.clj
(ns restful-crud.restful
  (:require ; ...
            [compojure.api.sweet :refer [... PUT]]
            ...))
; ...

(defn update-route [{:keys [name model req-schema enter]}]
  (let [enter-interceptor (or enter identity)
        path (resource-id-path name)]
    (PUT path http-req
      :path-params [id :- s/Int]
      :body [req-body req-schema]
      (db/update! model id (enter-interceptor req-body))
      (ok))))
```

### Delete Handler
```clojure
; src/restful_crud/restful.clj
(ns restful-crud.restful
  (:require ; ...
            [compojure.api.sweet :refer [... DELETE]]
            ...))
; ...

(defn delete-route [{:keys [name model]}]
  (let [path (resource-id-path name)]
    (DELETE path []
      :path-params [id :- s/Int]
      (db/delete! model :id id)
      (ok))))
```

### Combining All the Handlers 

The last piece that we need to implement is a function that put all the above handlers together. By making use of the `routes` function from Compojure-Api, we can achieve it as below.

```clojure
; src/restful_crud/restful.clj
(ns restful-crud.restful
  (:require ; ...
            [compojure.api.sweet :refer [... routes]]
            ...))
; ...
(defn resource [resource-config]
  (routes
   (create-route resource-config)
   (get-by-id-route resource-config)
   (get-all-route resource-config)
   (update-route resource-config)
   (delete-route resource-config)))
```

## Using the RESTful abstraction

Now we have the functionality in-place for exposing CRUD endpoints for any domain entity. We can leverage it for the `user` & the `book` entity.

```clojure
; src/restful_crud/user.clj
(ns restful-crud.book
  (:require ; ...
            [restful-crud.restful :as restful]))
; ...

(def user-entity-route
  (restful/resource {:model User
                     :name "users"
                     :req-schema UserRequestSchema
                     :leave #(dissoc % :password_hash)
                     :enter canonicalize-user-req}))
```

```clojure
; src/restful_crud/book.clj
(ns restful-crud.book
  (:require ; ...
            [restful-crud.restful :as restful]))
; ...

(def book-entity-route
  (restful/resource {:model Book
                     :name "books"
                     :req-schema BookRequestSchema}))
```

Then expose them in the `app`.

```clojure
; src/restful_crud/core.clj
(ns restful-crud.core
  (:require ; ...
            [restful-crud.user :refer [user-entity-route]]
            [restful-crud.book :refer [book-entity-route]])
  (:gen-class))

; (def app (api {:swagger swagger-config} 
;               (apply routes (concat user-routes book-routes))))
(def app (api {:swagger swagger-config} 
              (apply routes book-entity-route user-entity-route)))
```

If we want to expose RESTful CRUD APIs for a future entity, the steps that we need to follow are
* Create a table 
* Add the Toucan model
* Create a Schema for the request body
* Create `enter` & `leave` interceptor functions (if required)
* Expose the routes by calling the `resource` function with appropriate parameters.

That's it!

## Summary

We have followed this approach in our production codebase and exposed APIs for a significant number of domain entities. When we started the project, we didn't have this abstraction. After exposing CRUD APIs for some entities, we realised the repetitions in the code and derived this approach.

The sample implementation in this blog post not covers certain aspects like error-handling, audit-entries(created-by, updated-by), pagination for brevity. 

IMHO there is no [perfect abstraction](https://www.youtube.com/watch?v=zhpWhkW8kcc), and it applies to the one that we just saw as well. It was just perfect enough and enabled us to move faster. 

![](/img/clojure/blog/restful/how-to-abstract.png) *Credits- Alex Martelli's [Tower of abstractions talk](https://www.youtube.com/watch?v=zhpWhkW8kcc)

> The sample code is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.11/clojure/restful-crud).
