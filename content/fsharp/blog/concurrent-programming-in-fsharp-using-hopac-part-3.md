---
title: "Implementing API Gateway Pattern in fsharp using Hopac"
date: 2018-03-05T19:16:02+05:30
tags : ["fsharp", "Hopac", "concurrent-programming"]
---

Two years back, I wrote [a blog post](http://blog.tamizhvendan.in/blog/2015/12/29/implementing-api-gateway-in-f-number-using-rx-and-suave/) on how to implement [the API Gateway pattern](https://www.nginx.com/blog/building-microservices-using-an-api-gateway) using [Reactive Extensions](http://reactivex.io/)(Rx). In this third part of concurrent programming in fsharp using Hopac blog series, we are going to revisit that blog post and port it to use Hopac instead of Reactive Extensions.

## Rx vs Hopac

The critical difference between Rx and Hopac is their communication model.

Rx is primarily a system for querying data in motion asynchronously, and systems built using Rx rely on asynchronous message-passing. Whereas Hopac's programming model uses synchronous message passing (Rendezvous Point) using channels.

If you are interested in knowing more about the difference, check out this Rich Hickey's talk on [introducing Clojure core.async](https://www.infoq.com/presentations/clojure-core-async)


## The Problem Statement

Let's get started by spending some time on understanding the problem that we are going to solve.

Our objective is to write a backend which serves the data for showing a GitHub user profile like below

![](/img/fsharp/blog/hopac/Profile.png)

This profile view has three components.

**User** - Username and Avatar.

**Popular Repos** - Top three public repos of the Given User (determined by the number of stars).

**Languages** - Programming languages used in the corresponding repos.

To get these data from GitHub APIs, we need to make five API calls.

![](/img/fsharp/blog/hopac/Profile_With_API_Calls.png)

> We can use GitHub's [GraphQL API](https://developer.github.com/v4/) to minimise it. As the focus of this blog post is different, we are not going to consider this.

## Getting Started

Let's create a fsharp script file `ApiGateway.fsx` and add the following NuGet packages using Paket as we did in the earlier parts.


```bash
> touch ApiGateway.fsx
> forge paket init
> forge paket add Hopac
> forge paket add Http.fs // <1>
> forge paket add System.Net.Http // <2>
> forge paket add FSharp.Data // <3>
```

<1> [**Http.Fs**](https://github.com/haf/Http.fs) - A simple, functional HTTP client library for F# using Hopac

<2> [**System.Net.Http**](https://www.nuget.org/packages/System.Net.Http/) - A dependency of *Http.Fs*

<3> [**FSharp.Data**](http://fsharp.github.io/FSharp.Data) - For using [JSON Type Provider](http://fsharp.github.io/FSharp.Data/library/JsonProvider.html) and JSON serialization.

Then refer these packages in the script file

```fsharp
#r "packages/Hopac/lib/net45/Hopac.Core.dll"
#r "packages/Hopac/lib/net45/Hopac.Platform.dll"
#r "packages/Hopac/lib/net45/Hopac.dll"
#r "packages/Hopac/lib/net45/Hopac.dll"
#r "packages/FSharp.Data/lib/net45/FSharp.Data.dll"
#r "packages/Http.fs/lib/net461/HttpFs.dll"
#r "packages/System.Net.Http/lib/net46/System.Net.Http.dll"

open Hopac
open FSharp.Data
open HttpFs.Client
```

## Setting up GitHub Http GET request

According to GitHub API version 3 [specification](https://developer.github.com/v3), the presence of `User-Agent` header is [mandatory](https://developer.github.com/v3/#user-agent-required) for all API requests.

As we are going to use only HTTP GET requests, let's create a function `httpGet` that takes care of passing `User-Agent` header in all the HTTP Get requests


```fsharp
// string -> Job<string>
let httpGet url =
  Request.createUrl Get url // Request
  |> Request.setHeader (UserAgent "FsHopac") // Request
  |> getResponse // Alt<Response> // <1>
  |> Job.bind Response.readBodyAsString // Job<string> // <2>
```

<1> `getResponse` is a function from *Http.Fs* library that fires the HTTP request and returns the Response as `Alt`, a subclass of Hopac's `Job`.

<2> As the name indicates, the `readBodyAsString` function (`Response -> Job<string>`) read the response body and return its string representation.

<2> The `bind` function creates a job that first runs the given job (`Job<Response>`) and then passes the result of that job (`Response`) to the given function (`Response -> Job<string>`) to build another job which will then be run.

```fsharp
val bind: ('x -> Job<'y>) -> Job<'x> -> Job<'y>
```

## Getting User

To parse the user information from GitHub, let's create the JSON Type Provider for the User.

```fsharp
type UserTypeProvider = JsonProvider<"https://api.github.com/users/tamizhvendan">
type User = UserTypeProvider.Root
```

Then, we can make use of the `httpGet` function that we defined earlier to get the User JSON response from GitHub and parse the response using the `UserTypeProvider`.


```fsharp
let basePath = "https://api.github.com"

// string -> string
let userUrl = sprintf "%s/users/%s" basePath

// string -> Job<User>
let getUser username : Job<User> =
  userUrl username
  |> httpGet // Job<string>
  |> Job.map UserTypeProvider.Parse // Job<User> // <1>
```

<1> The `Job.map` function creates a job that runs the given job (`Job<string>`) and maps the result of the job (`string`) with the given function (`string -> User`).

```fsharp
val map: ('x -> 'y) -> Job<'x> -> Job<'y>
```

We can verify the `getUser` function using the F# interactive

```bash
> getUser "tamizhvendan" |> run;;
val it : User =
  {
  "login": "tamizhvendan",
  "id": 1128916,
  "avatar_url": "https://avatars0.githubusercontent.com/u/1128916?v=4",
  ...
  }
```

## Getting Top Three User Repo

Our next task is getting the top three repos of the user based on the count of stars. As we did for `User`, let's start by defining the `Repo` type using the JSON Type Provider.


```fsharp
type ReposTypeProvider =
  JsonProvider<"https://api.github.com/users/tamizhvendan/repos">
type Repo = ReposTypeProvider.Root
```

Then, we have to add a function that returns the top three repos from the given repos.

```fsharp
// Repo [] -> Repo []
let topThreeUserRepos (repos : Repo []) =
  let takeCount =
    let reposCount = Array.length repos
    if reposCount > 3 then 3 else reposCount
  repos
  |> Array.filter (fun repo -> not repo.Fork) // Repo shouldn't be a fork
  |> Array.sortByDescending (fun repo -> repo.StargazersCount)
  |> Array.take takeCount
```

The final step is wiring up the `getTopThreeUserRepo` function with the help of the functions that we defined so far.

```fsharp
let userReposUrl = sprintf "%s/users/%s/repos?per_page=100" basePath

// string -> Job<Repo []>
let getTopThreeUserRepos username : Job<Repo []> =
  userReposUrl username
  |> httpGet // Job <string>
  |> Job.map ReposTypeProvider.Parse // Job <Repo []>
  |> Job.map topThreeUserRepos // Job <Repo []>
```

We can verify this in F# interactive as well

```bash
> getTopThreeUserRepos "tamizhvendan" |> run;;
val it : Repo [] =
  [|{
  "id": 12037577,
  "name": "blog-samples",
  "full_name": "tamizhvendan/blog-samples"
  ...]
```

The list user repositories GitHub API that we are using here returns a maximum of 100 repositories per page, and we need to use their [pagination logic](https://developer.github.com/v3/guides/traversing-with-pagination/) to fetch all the repositories.

We are going ahead with this underlying implementation, and we'll address pagination later in this blog post.


## Getting Repo Languages

The GitHub API for returning a repo's languages has the following JSON structure

```json
{
  "F#": 65237,
  "JavaScript": 25034,
  "Shell": 876,
  "HTML": 391,
  "Batchfile": 214
}
```
From the response, we can see that the languages API response doesn't have a fixed schema. So, to get the languages, we need to parse the JSON and pick only its keys.

We can make use of the `JsonValue.Parse` function from *FSharp.Data* library to do it.

```fsharp
// string -> string []
let parseLanguagesJson languagesJson =
  languagesJson
  |> JsonValue.Parse // JsonValue
  |> JsonExtensions.Properties // (string * JsonValue) []
  |> Array.map fst // string []
```

Then we can leverage this function to get the languages of a user repo.

```fsharp
let languagesUrl userName repoName  =
  sprintf "%s/repos/%s/%s/languages" basePath userName repoName

// string -> string -> Job <string []>
let getUserRepoLanguages username repoName =
  languagesUrl username repoName
  |> httpGet // Job<string>
  |> Job.map parseLanguagesJson // // Job<string []>
```

Running this function in F# interactive will give us the following output

```bash
getUserRepoLanguages "tamizhvendan" "CafeApp" |> run;;
val it : string [] = [|"F#"; "JavaScript"; "Shell"; "HTML"; "Batchfile"|]
```

## The Climax

Alright, now we have three individual functions that take care of fetching the different components.

```fsharp
val getUser : string -> Job<User>
val getTopThreeUserRepos : string -> Job<Repo []>
val getUserRepoLanguages : string -> string -> Job <string []>
```

The final piece is putting all these functions together and prepare the expected response. Before getting into that region, let's define some types to represent the last answer that we want and a helper function to construct it.

```fsharp
type RepoDto = {
  Name : string
  StargazersCount : int
  Languages : string []
}

// Repo -> string [] -> RepoDto
let repoDto (repo : Repo) languages = {
  Name = repo.Name
  StargazersCount = repo.StargazersCount
  Languages = languages
}
```

```fsharp
type UserDto = {
  Name : string
  AvatarUrl : string
  TopThreeRepos : RepoDto []
}
```

To construct this response, we can call these functions sequentially inside a `job` computation expression and populate the `UserDto` from the return values.

But do we need to run them sequentially in the first place? We can run them in parallel as well.

We can run the jobs `Job<User>` & `Job<Repo []>` parallelly. And then for each `Repo` in the `Repo []`, we can get their respective languages job `Job<string []>` and run each of them parallelly. Finally, we can combine all of them and create `UserDto`.

Let's see it in action


```fsharp
open Hopac.Infixes

// string -> Repo -> Job<RepoDto>
let getRepoDto username (repo : Repo) =
  getUserRepoLanguages username repo.Name
  |> Job.map (repoDto repo)

// string -> Job<UserDto>
let getUserDto username = job {
  let! user, repos =
    getUser username <*> getTopThreeUserRepos username // <1>
  let! repoDtos =
    repos
    |> Array.map (getRepoDto username) // <2>
    |> Job.conCollect // <3>
  return {
    Name = user.Name
    AvatarUrl = user.AvatarUrl
    TopThreeRepos = repoDtos.ToArray()
  }
}
```

<1> Uses the infix function `<*>` that we saw in the part-1 to run the given two jobs parallelly and returns their results as a Tuple.

<2> For each `Repo` in the `repos` array, we are getting their respective `Job<RepoDto>` using the `getRepoDto` function.

<3> `Job.conCollect` creates a job that runs all of the jobs as separate concurrent jobs and returns their results as [ResizeArray](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/collections.resizearray%5B't%5D-type-abbreviation-%5Bfsharp%5D).

```fsharp
val conCollect: seq<Job<'x>> -> Job<ResizeArray<'x>>
```

That's all.

Let's run this function in F# interactive and verify our implementation

```fsharp
getUserDto "tamizhvendan" |> run;;
val it : UserDto =
  {Name = "Tamizhvendan S";
   AvatarUrl = "https://avatars0.githubusercontent.com/u/1128916?v=4";
   TopThreeRepos =
    [|{Name = "blog-samples";
       StargazersCount = 89;
       Languages = [|"F#"; "HTML"; "Liquid"; "JavaScript"|];};
      {Name = "CafeApp";
       StargazersCount = 66;
       Languages = [|"F#"; "JavaScript"; "Shell"; "HTML"; "Batchfile"|];};
      {Name = "fsharp-phonecat";
       StargazersCount = 12;
       Languages = [|"JavaScript"; "F#"; "C#"; "CSS"; "Shell"; "ASP"|];}|];}
```

Hurrah, Everything is working as expected!

### Adding Pagingation Support

As mentioned earlier, in this sub-section we are going to add the support for pagination in the get all public repositories API.

The [pagination](https://developer.github.com/v3/#pagination) logic in GitHub APIs uses the [Link](https://developer.github.com/v3/#link-header) header in the HTTP response, to communicate the navigation URLs.


A sample value of the `Link` header would look like

```
  <https://api.github.com/user/193115/repos?per_page=100&page=1>; rel="prev",
  <https://api.github.com/user/193115/repos?per_page=100&page=3>; rel="next",
  <https://api.github.com/user/193115/repos?per_page=100&page=3>; rel="last",
  <https://api.github.com/user/193115/repos?per_page=100&page=1>; rel="first"
```

To support pagination in our implementation, let's create a new type for representing the GitHub's response.

```fsharp
type GitHubResponse = {
  Body : string
  NextPageUrl : string option
}
```

Then we need to write a function to extract the `next` pagination URL from the value of the Link header

```fsharp
// string -> string option
let getNextPageUrl (linkText : string) =
  linkText.Split([|','|])
  |> Array.map (fun l -> l.Split([|';'|]))
  |> Array.tryFind(fun l -> l.Length = 2 && l.[1].Contains("next"))
  |> Option.map(fun l -> l.[0].Trim().TrimStart('<').TrimEnd('>'))
```

The next step is, from the HTTP response, we need to populate the `GitHubResponse`.

```fsharp
// Response -> Job<GitHubResponse>
let gitHubResponse response = job {
  let! body = Response.readBodyAsString response
  let nextPageUrl =
    match response.headers.TryFind(ResponseHeader.Link) with
    | Some linkText -> getNextPageUrl linkText
    | None -> None
  return {Body = body; NextPageUrl = nextPageUrl}
}
```

The current implementation of `httpGet` function just returns the body of the response. But to support pagination, we need a value of `GitHubResponse`. So, let's create a new function `httpGetWithPagination` to address this need.

```fsharp
// string -> Job<GitHubResponse>
let httpGetWithPagination url =
  Request.createUrl Get url // Request
  |> Request.setHeader (UserAgent "FsHopac") // Request
  |> getResponse // Job<Response>
  |> Job.bind gitHubResponse // Job<GitHubResponse>
```

We can modify the `httpGet` function to make use this function

```diff
let httpGet url =
- Request.createUrl Get url
- |> Request.setHeader (UserAgent "FsHopac")
- |> getResponse
- |> Job.bind Response.readBodyAsString
+ httpGetWithPagination url
+ |> Job.map (fun r -> r.Body)
```

Now we have the HTTP support in place for pagination. The next step is navigating through the pagination links and get all the user repos.


```fsharp
// string -> Job<Repo []>
let getAllUserRepos username =

  // string -> Repo list -> Job<Repo list>
  let rec getAllUserRepos' url (repos : Repo list) = job {  // <1>
    let! gitHubResponse = httpGetWithPagination url // GitHubResponse
    let currentPageRepos =
      gitHubResponse.Body // string
      |> ReposTypeProvider.Parse // Repo []
      |> Array.toList // Repo list
    let reposSoFar = repos @ currentPageRepos // <2>
    match gitHubResponse.NextPageUrl with
    | Some nextPageUrl -> // <3>
       return! getAllUserRepos' nextPageUrl reposSoFar // <4>
    | None -> return reposSoFar // <5>
  }

  getAllUserRepos' (userReposUrl username) [] // Job<Repo list> // <6>
  |> Job.map (List.toArray) // Job<Repo []>
```

<1> - The recursive function `getAllUserRepos'` implements the page navigation logic and the outer function `getAllUserRepos` calls this recursive one (at // <6>) with the initial URL and an empty list of `Repo`.

<2> - After getting the `Repo list` of the current page, the `getAllUserRepos'` function concatenates it with the repos from the initial list.

<3> - If the current page has the next page URL, we are calling the `getAllUserRepos'` function recursively with the next page's URL and repo lists populated so far (at // <4>).

<5> - If we reached the last page, we just return the repo lists populated so far


The final set of change is, calling this `getAllUserRepos` function from the `getTopThreeUserRepos` function

```diff
 let getTopThreeUserRepos username : Job<Repo []> =
-  userReposUrl username
-  |> httpGet
-  |> Job.map ReposTypeProvider.Parse
+  getUserAllRepos username
   |> Job.map topThreeUserRepos
```

### Adding Log

If the run the current implementation in F# interactive, we just see the final output and we have no clue about what is happening behind the scenes.

To get this insight let's sprinkle some log statements.

```fsharp
let log msg x =
  printfn "%s" msg
  x
```

```diff
let httpGetWithPagination url =
  Request.createUrl Get url
  |> Request.setHeader (UserAgent "FsHopac")
+ |> log ("Request : " + url)
  |> getResponse
  |> Job.bind gitHubResponse
+ |> Job.map (log ("Response : " + url))
```

If we run the `getTopThreeUserRepos` function with the username (`haf`) of [Henrik Feldt's](https://twitter.com/henrikfeldt), co-author of [Suave](https://suave.io), who is having `280` public repositories,

```fsharp
#time "on"
getUserDto "haf" |> run
#time "off"
```

We'll get the following output

```bash
--> Timing now on

Request : https://api.github.com/users/haf
Request : https://api.github.com/users/haf/repos?per_page=100
Response : https://api.github.com/users/haf
Response : https://api.github.com/users/haf/repos?per_page=100
Request : https://api.github.com/user/193115/repos?per_page=100&page=2
Response : https://api.github.com/user/193115/repos?per_page=100&page=2
Request : https://api.github.com/user/193115/repos?per_page=100&page=3
Response : https://api.github.com/user/193115/repos?per_page=100&page=3
Request : https://api.github.com/repos/haf/expecto/languages
Request : https://api.github.com/repos/haf/Http.fs/languages
Request : https://api.github.com/repos/haf/DotNetZip.Semverd/languages
Response : https://api.github.com/repos/haf/expecto/languages
Response : https://api.github.com/repos/haf/DotNetZip.Semverd/languages
Response : https://api.github.com/repos/haf/Http.fs/languages
Real: 00:00:04.179, CPU: 00:00:01.078, GC gen0: 3, gen1: 1
val it : UserDto =
  {Name = "Henrik Feldt";
   AvatarUrl = "https://avatars0.githubusercontent.com/u/193115?v=4";
   TopThreeRepos =
    [|{Name = "expecto";
       StargazersCount = 220;
       Languages = [|"F#"; "C#"; "Shell"; "Batchfile"|];};
      {Name = "Http.fs";
       StargazersCount = 197;
       Languages = [|"HTML"; "F#"; "Ruby"; "Batchfile"; "Shell"|];};
      {Name = "DotNetZip.Semverd";
       StargazersCount = 178;
       Languages =
        [|"C#"; "HTML"; "Visual Basic"; "ASP"; "Smalltalk"; "JavaScript";
          "Batchfile"; "Ruby"; "PowerShell"; "C++"; "Makefile"; "PHP"; "Perl"|];}|];}


--> Timing now off
```

From this log, we can infer that the requests to get the user and repo's first page are parallel, then the requests for navigating each page is sequential, and finally, requests for obtaining the languages of top three repos are parallel.

### Exposing HTTP endpoint

The final piece of work that we need to do is exposing the `getUserDto` function via HTTP GET API.

Add [Suave](https://suave.io) NuGet package and refer them in the script file

```bash
forge paket add Suave
```

```fsharp
// ...
#r "packages/Suave/lib/net40/Suave.dll"

// ...
open Suave
open Suave.Successful
open Suave.Operators
open System.Threading

// ...
```

To serialise `UserDto` and `RepoDto` to JSON, let's add `ToJson` function which transforms the DTOs to FSharp.Data's `JsonValue` type.

```fsharp
type RepoDto = {
  // ...
} with
  static member ToJson(r : RepoDto) =
    let languages =
      r.Languages
      |> Array.map (JsonValue.String)
      |> JsonValue.Array
    let stars =
      r.StargazersCount |> decimal |> JsonValue.Number
    JsonValue.Record [|
      "name", JsonValue.String r.Name
      "stars", stars
      "languages", languages
    |]
```

```fsharp
type UserDto = {
  // ...
} with
  static member ToJson(u : UserDto) =
    let topThreeRepos =
      u.TopThreeRepos
      |> Array.map RepoDto.ToJson
      |> JsonValue.Array
    JsonValue.Record [|
      "name", JsonValue.String u.Name
      "avatarUrl", JsonValue.String u.AvatarUrl
      "topThreeRepos", topThreeRepos
    |]
  static member ToJsonString(u : UserDto) =
    UserDto.ToJson(u).ToString()
```

The `ToJsonString` function returns the string representation of the `UserDto`'s `JsonValue`.


Then write the `getUserApi` function that calls the `getUserDto` function and transforms the return value to the corresponding HTTP response.


```fsharp
open Suave.Operators // <1>

// string -> HttpContext -> Async<HttpContext option>
let getUserApi username ctx = async {
  let! userDtoResponse =
    getUserDto username // Job<UserDto>
    |> Job.catch // Job<Choice<UserDto, exn>> // <2>
    |> Job.toAsync // Async<Choice<UserDto, exn>> // <3>
  match userDtoResponse with
  | Choice1Of2 userDto ->
    let res =
      userDto
      |> UserDto.ToJsonString
      |> OK
      >=> Writers.setMimeType "application/json; charset=utf-8"
    return! res ctx
  | Choice2Of2 ex ->
    printfn "%A" ex
    return! ServerErrors.INTERNAL_ERROR "something went wrong" ctx
}
```

<1> Opens the module `Suave.Operators` here instead of at the beginning of the file as `>=>` symbol is also defined in *Hopac.Infixes* module

<2> The `Job.catch` function creates a job that runs the given job and results in either the result of the job or the exception raised by the job.

<3> The `Job.toAsync` function creates an async operation that starts the given job and waits for it to complete


Finally, wire up the `getUserApi` function with a path and start the Suave server.

```fsharp
let app = pathScan "/api/profile/%s" getUserApi

let startServer () =
  let cts = new CancellationTokenSource()
  let listening, server =
    startWebServerAsync defaultConfig app
  Async.Start(server, cts.Token) |> ignore
  Async.RunSynchronously listening |> ignore
  cts

let stopServer (cts : CancellationTokenSource) =
  cts.Cancel true
  cts.Dispose()
```

```bash
> let cts = startServer ();;
[09:45:15 INF] Smooth! Suave listener started in 1.712 with binding 127.0.0.1:8080
val cts : CancellationTokenSource
```

We can then verify the API via Curl.

![](/img/fsharp/blog/hopac/api_response.png)

Awesome!!

> Make sure that we stop the server using the `stopServer` function (as we are using F# Script to run the HTTP server).
```bash
> stopServer cts;;
val it : unit = ()
```


## Summary

> Parallelism is merely running things in parallel. Concurrency is a way to structure your program. - Rob Pike

It is precisely what we did in this blog post. We structured the execution of `Job`s declaratively and get the `job` *(pun intended)* done with the help of Hopac.

We have also learned the `Job.bind`, `Job.map`, `Job.catch`, `Job.toAsync` & `Job.conCollect` functions from the Hopac library on the way. The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.5/fsharp/HopacSeries/Part3)
