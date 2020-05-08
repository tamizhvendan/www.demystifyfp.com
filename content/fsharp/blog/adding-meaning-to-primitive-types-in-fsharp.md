---
title: "Adding Meaning to Primitive Types in fsharp"
date: 2018-02-12T19:23:36+05:30
tags : ["fsharp", "monoid", "Category Theory"]
---

One of the recommended guidelines in Domain Driven Design is modelling the domain ideas using the domain type (CustomerName, CustomerId) instead of using their corresponding primitive type (string, int). In fsharp, with the help of [Single-Case Discriminated Union](https://fsharpforfunandprofit.com/posts/designing-with-types-single-case-dus/), we can follow this guideline with minimal effort.

While following this practice in one of my recent project in fsharp, I came across a compelling use case, and I used a lesser-known approach to solve the problem. In this blog post, I will be sharing the method that I employed to address the use case.

## The Problem Domain

Let's assume that we are developing a F# Application for managing our expenses.

One of the core domain idea that we'll use a lot is **Money**.

In .NET, the primitive data type `decimal` is appropriate for financial and monetary calculations.

Hence to model **Money** in fsharp, what we need is a Single Case Discriminated Union type wrapping the `decimal` type.

```fsharp
type Money = Money of decimal
```

> To keep things simple, we are not going to consider currency and exchange rates.


The next thing is modelling the income source and expense categories. For brevity, let's keep just two in each.

```fsharp
type IncomeSource =
| Salary
| Royalty

type ExpenseCategory =
| Food
| Entertainment
```

The final domain representation that we need is `Transaction`, which is either a `Credit` or a `Debit`.

```fsharp
type Income = {
  Amount : Money
  Source : IncomeSource
}

type Expense = {
  Amount : Money
  Category : ExpenseCategory
}

type Transaction =
| Credit of Income
| Debit of Expense
```

For our small personal finance managing application, these domain models are just sufficient. So, let's dive into the use cases.


### Use Case #1

Our first use case is finding the expenditure on a given `ExpenseCategory` from the list of the transaction

```fsharp
ExpenseCategory -> Transaction list -> Money
```

To implement it, let's create an intermediate function `getExpenses`, that retrieves the expenses from a list of the transaction.

```fsharp
// Transaction list -> Expense list
let rec getExpenses transactions =
  getExpenses' transactions []
and getExpenses' transactions expenses =
  match transactions with
  | [] -> expenses
  | x :: xs ->
    match x with
    | Debit expense ->
      getExpenses' xs (expense :: expenses)
    | _ -> getExpenses' xs expenses
```

With the help of this `getExpenses` function, we can now implement the use case as follows


```fsharp
// ExpenseCategory -> Transaction list -> Money
let getExpenditure expenseCategory transactions =
  getExpenses transactions
  |> List.filter (fun e -> e.Category = expenseCategory)
  |> List.sumBy (fun expense ->
    let (Money m) = expense.Amount // <1>
    m // <2>
  )
  |> Money // <3>
```

<1> Unwrapping the underlying `decimal` value from the `Money` type.

<2> Returning the unwrapped decimal value.

<3> Putting the decimal value back to `Money` type after computing the sum.


Now we have an implementation for use case #1 and let's move to the next.

### Use Case #2

The second use case is computing the average expenditure on a given `ExpenseCategory` from the list of transactions


```fsharp
// ExpenseCategory -> Transaction list list -> Money
let averageExpenditure expenseCategory transactionsList =
  transactionsList
  |> List.map (getExpenditure expenseCategory)
  |> List.map (fun (Money m) -> m) // <1>
  |> List.average
  |> Money // <2>
```

Like the use case #1,

<1> Unwraps the `decimal` value from the `Money` type and returns it.

<2> Put the result of the average function back to the `Money` type.


### Use Case #3

Our final use case is from the list of transaction, we have to compute the balance money.

As we know, the formula for computing the balance is

```plain
balance money = (sum of credited amount of money) - (sum of debited amount of money)
```
Applying the same in fsharp, we will end up with the following implementation


```fsharp
// Transaction list -> Money
let balance transactions =
  transactions
  |> List.map ( function
                | Credit x ->
                  let (Money m) = x.Amount // <1>
                  m
                | Debit y ->
                  let (Money m) = y.Amount // <2>
                  -m
              )
  |> List.sum
  |> Money // <3>
```

In the `balance` function, we have used an optimised version of the formula.

Instead of computing the sum of credits and debits separately, we are applying the unary minus to all debits and calculating the sum of these transformed values in a single go.

Like what we did for the use cases #1 and #2, Here also we are unwrapping the `decimal` type from the `Money` type at  <1> and <2>, and at <3> we are wrapping the `decimal` type back to `Money` type after computing the sum.

## Unwrapping and Wrapping Boilerplate

Though we have a good domain model in the form of `Money`, a discouraging aspect is the repetition of unwrapping and wrapping code to perform calculations on the `Money` type. We might be repeating the same for the future use cases as the `Money` type is an integral part of the application.

Is there any way to get rid of this redundancy?

Yes, There is!


### List.sumBy function

The solution that we are looking for is lurking in the signature of the `List.sumBy` function

```fsharp
List.sumBy : ('T -> ^U) -> 'T list -> ^U
  (requires ^U with static member (+) and ^U with static member Zero)
```

The `sumBy` function makes use of [Statically resolved type parameters](https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/generics/statically-resolved-type-parameters) to define the the target type `^U` (to be summed). As indicated in the signature, the type `^U` should have two static members `+` and `Zero`.

In our case, the primitive type `decimal` already has these static members, and the wrapper type `Money` doesn't have it. Hence we are doing the wrapping and unwrapping!

Let's add these two static members in the `Money` type


```fsharp
type Money = Money of decimal with

  // Money * Money -> Money
  static member (+) (Money m1, Money m2) = Money (m1 + m2) // <1>

  static member Zero = Money 0m // <2>
```

<1> Unwraps the `decimal` type for two operands of `Money` and returns the summed value with the target type `Money`

<2> Returns the zeroth value of Money


We can now refactor the `getExpenditure` function as

```diff
 let getExpenditure expenseCategory transactions =
   getExpenses transactions
   |> List.filter (fun e -> e.Category = expenseCategory)
-  |> List.sumBy (fun expense ->
-    let (Money m) = expense.Amount
-    m
-  )
-  |> Money
+  |> List.sumBy (fun expense -> expense.Amount)
```

### List.average function

Like the `List.sumBy` function, the `List.average` function has a requirement.

```fsharp
// Signature
List.average : ^T list -> ^T
  (requires ^T with static member (+) and
    ^T with static member DivideByInt and
    ^T with static member Zero)
```

Out of these three requirements, we have already covered two (`+` & `Zero`) while accommodating the `List.sumBy` function's requirement.

So, we just need to implement `DivideByInt` static member in `Money` to compute the average.

```fsharp
type Money = // ...
  // ...
  static member DivideByInt ((Money m), (x : int)) =
    Decimal.Divide(m, Convert.ToDecimal(x))
    |> Money
```

With this change, we can refactor `averageExpenditure` as below

```diff
  let averageExpenditure expenseCategory transactionsList =
    transactionsList
    |> List.map (getExpenditure expenseCategory)
-   |> List.map (fun (Money m) -> m)
-   |> List.average
-   |> Money
+   |> List.average
```

### Unary Minus on Money Type

The final function that needs our help is the `balance` function. To make the `unary minus` work on `Money` type, we can make use of [operator overloading](https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/operator-overloading) in fsharp.

```fsharp
type Money = // ...
  // ...
  static member (~-) (Money m1) = Money -m1
```

And then we can refactor the `balance` function

```diff
 let balance transactions =
   transactions
-  |> List.map ( function
-                | Credit x ->
-                  let (Money m) = x.Amount // <1>
-                  m
-                | Debit y ->
-                  let (Money m) = y.Amount // <2>
-                  -m
-              )
-  |> List.sum
-  |> Money
+  |> List.map ( function
+                | Credit x -> x.Amount
+                | Debit y -> -y.Amount)
+  |> List.sum
```

## Summary

In this blog post, we saw how to avoid some boilerplate code while creating domain types for primitives in fsharp. On a side note, by adding the static members `+` and `Zero` we made the `Money` type a [Monoid](https://en.wikipedia.org/wiki/Monoid). The `List.sum` and `List.sumBy` functions are designed to act on any Monoids and hence we solved the use cases with less code!

The source code is available on [GitHub](https://github.com/demystifyfp/BlogSamples/tree/0.1)
