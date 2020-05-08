---
title: "A Deep Dive Into Pattern Matching and Destructuring - Part 1"
date: 2019-11-02T08:18:21+05:30
draft: true
tags: ['Clojure', 'Kotlin']
---

Pattern Matching and Destructuring are two simple, yet powerful features in functional programming languages. There are several ways we can leverage them to make cleaner code. It also encourages you to think data as a first-class citizen and provide the essential tooling.

In this blog post, we are going to learn what these techniques bring to the table by looking at some real-world use-cases in Kotlin & Clojure. 

## It's not something new

Assume that we have array of strings

```kotlin
val texts = arrayOf(
  "The flight arrived at 12:34:22.",
  "The meeting starts at 20:30:00."
)
```

And our task is to extract the timestamp value and print the hour, minute and second value like this

```batch
Hour: 12, Minute: 34, Second: 22
Hour: 20, Minute: 30, Second: 00
```

How do we implement it? 

A naive approach is using the substring, index and split functions of the string and get the job done

```kotlin
fun printTimestamp(text : String) {
  val atIndex = text.indexOf("at")
  val timestamp =
    text
      .subSequence(atIndex + 3, atIndex + 11)
      .split(':')
  val hour = timestamp[0]
  val minute = timestamp[1]
  val second = timestamp[2]
  println("Hour: $hour, Minute: $minute, Second, $second")
}
texts.forEach { printTimestamp(it) }
```

How do you feel about this code? Is there any other approaches to improve this? 

If you guesses it right, we can solve this using regular expression. 

```kotlin
fun printTimestampV2(text : String) {
  val pattern = "(\\d\\d):(\\d\\d):(\\d\\d)"
  val regex = pattern.toRegex()
  val timestamp = regex.find(text)!!.groupValues
  val hour = timestamp[1]
  val minute = timestamp[2]
  val second = timestamp[3]
  println("Hour: $hour, Minute: $minute, Second, $second")
}
texts.forEach { printTimestampV2(it) }
```

In the second version, there is no concept of substring, index or split! 

Though it has some little bit of learning curve to understand regular expression, the resulting code is less manipulative and simpler. 

What made this difference?

There is a pattern in the text we are operating. In the second version, we recognized it and used the regular expression's capability to achieve our objective. 

This pattern recognition and matching to extract values out of a string is not only limited to string. It can be applied at any data level. Before, we reach there let's spend some time on how we are representing data in our systems.

## Representing Data

Most of the business line of application that we build are information processing systems. The **information** here are just **data**. 

How do we encode the data? 

The programming language that we use provides a set of primitive data types like integer, float, string, etc., It also provides collection types like Array, List, Hashmap, Set and so on. But these primitives alone are not sufficient to represent a *data* from the business domain. 

Let's take the timestamp that we just saw. It has `hour`, `minute` and `second`. We can represent it as a array of three integers

```kotlin
val timestamp = arrayOf(12, 34, 22)
```

This encoding has a major flaw. Can you guess what it is? 

A downstream functionality which is going to use this timestamp has to remember that the first item is `hour`, second one is `minute` and the last one is `second`. This extra cognitive load will hurt a lot in a real world business line of applications where we will be having a lot of domain entities. 

Thankfully, we don't need to take this route to represent something in the business domain. 

In object oriented programming, we will be using objects to achieve this. 

Let's see how we can represent it in Java. Java standard library has a class called [LocalTime](https://docs.oracle.com/javase/8/docs/api/java/time/LocalTime.html) using which we can use to create objects to represent a time without timezone. 

```java
import java.time.LocalTime;

class Program {
  public static void main(String[] args) {
    LocalTime timestamp = LocalTime.of(12, 34, 22);
    System.out.println(timestamp);
  }
}
```

To get the `hour`, `minute` and `second` out of this *LocalTime* object, the *LocalTime* provides separate methods.

```java
LocalTime timestamp = LocalTime.of(12, 34, 22);
int hour = timestamp.getHour();
int minute = timestamp.getMinute();
int second = timestamp.getSecond();
```

### A different perspective 

In Object-Oriented programming, we use objects to hold the data. To get the data out of an object, we need to provide custom methods, like `getHour`, `getMinute` and `getSecond` here. 

Let's assume that we need to represent a two dimensional point. The typical apporach is create a class `Point` with two getter methods. 

```java
class Point {
  private final int x;
  private final int y;

  public Point(int x, int y) {
    this.x = x;
    this.y = y;
  }

  public int getX() {
    return x;
  }

  public int getY() {
    return y;
  }
}
```

```java
class Program {
  public static void main(String[] args) {
    Point p1 = new Point(0, 0);
    Point p2 = new Point(0, 5);
    System.out.printf("P1: (%d, %d), P2: (%d, %d)",
            p1.getX(), p1.getY(), p2.getX(), p2.getY());
  }
}
```

Here is quiz for you, what is the output of the following code ?

```java
class Scratch {
  public static void main(String[] args) {
    Point p1 = new Point(0, 0);
    System.out.println(p1.equals(new Point(0, 0)));
  }
}
```

It's `false`. Even though both the points has the same value for `x` and `y`, they are not considered equal, as both are separate objects. To treat these objects as values, we need to override the `equals` and the `hashCode` method.

```java
class Point {
  // ...
  @Override
  public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    Point point = (Point) o;
    return x == point.x && y == point.y;
  }

  @Override
  public int hashCode() {
    return Objects.hash(x, y);
  }
}
```

Just take a moment, to reflect on what we did here. 

We need a way to represent a two dimensional point, So, we created a class called `Point`. To retrieve the `x` and `y` values, we created two separate getter methods. To treat these objects as values we overrided the `equals` and `hashCode` methods. That's quite a bit of work, isn't it?

Let's compare this `Point` class with the `LocalTime` class that we saw earlier. We used both to hold the data, `x` & `y` and `hour`, `minute` & `second` respectively. To get these values out, we need specific implementations. 

Can you see a pattern here?

If the main purpose of the Class is to hold the data, then classes are nothing but a set of named placeholders of some arbitary values!

Kotlin embraces this thought process and provides us [Data Class](https://kotlinlang.org/docs/reference/data-classes.html) to support these kind of scenarios. The Data Class for representing `Point` would look like this

```kotlin
data class Point(val x : Int, val y : Int)
```

This definition follows the data semantics and hence comparing two instances of this `Point` class which has same values will return `true`.

```kotlin
println(Point(0, 0) == Point(0,0))
```

Like data, it is immutable as well. 

In Clojure, data is a first class citizen and representing an instance of `Point` in Clojure would look this

```clojure
{:x 0 :y 0}
```
It is a map data structure with the keys representing the attribute name.

The keys `:x` and `:y` doesn't communicate much about what they mean. So, we can make use of Clojure's namespaced keyword to make it meaningful. 

```clojure
{:point/x 0 :point/y 0}
```

It is immutable and comparing the two different points having same value will return `true` 

```clojure
(= {:point/x 0 :point/y 0} {:point/x 0 :point/y 0})
```

In this section, we saw how to represent a data in Java, Kotlin & Clojure and understood the semantics behind each of them. In OO, we mix data and behaviour inside objects. Whereas in FP, we view them separately and treat data as immutable. 

## Extracting Data

If we represent a value using objects, we need to provide the getter methods to get the values out of the object. 

But if we treating data as a set of key value pairs, do we still need it? 

Let me pull the regular expression that we saw earlier to extract the timestamp.

```kotlin
val pattern = "(\\d\\d):(\\d\\d):(\\d\\d)"
// ...
```

What is the role of paranthesis here? They capture the text matched by the regex inside them into a numbered group that can be reused with a numbered backreference. 

Now let's look at the data representation. 

```clojure
{:x 0 :y 0}
```

What is the role of keys here? They capture the value provided and associate them with a name. 

Like how we extracted the `hour`, `minute` and `second` from the numbered group

```kotlin
val pattern = "(\\d\\d):(\\d\\d):(\\d\\d)"
val regex = pattern.toRegex()
val timestamp = regex.find(text)!!.groupValues
val hour = timestamp[1] // <-
val minute = timestamp[2] // <-
val second = timestamp[3] // <-
```

We can extract the values from the new data reprentation using their names

```clojure
(defn print-point [p1]
  (let [{:keys [x y]} p1]
    (printf "P1: (%d, %d)" x y)))

(print-point {:x 0 :y 0})
```

This is called **associative destructuring**. In other words, we matched the values of the map with their associated names and extracted them for further use.

> Note: At the time of this writing, Kotlin [doesn't support](https://discuss.kotlinlang.org/t/position-based-declaration-destructuring/3787) associative destructuring.

There is another destucturing technique called **positional destructuring**, extracting data using their position. 

In the regex example, the return value of `groupValues` is an array of four elements, with the first element containing the whole matched string and the rest contains the grouped value strings. 

```kotlin
// ...
val timestamp = regex.find(text)!!.groupValues
val hour = timestamp[1]
val minute = timestamp[2]
val second = timestamp[3]
println("Hour: $hour, Minute: $minute, Second, $second")
```

Using destructuring we can simplify the above code using positional destructuring like below.

```kotlin
fun printTimestampV3(text : String) {
  val pattern = "(\\d\\d):(\\d\\d):(\\d\\d)"
  val regex = pattern.toRegex()
  val (_, hour, minute, second) = regex.find(text)!!.groupValues
  println("Hour: $hour, Minute: $minute, Second: $second")
}
```

The corresponding example in Clojure would like this.

```clojure
(defn print-timestamp [text]
  (let [pattern                #"(\d\d):(\d\d):(\d\d)"
        [_ hour minute second] (re-find pattern text)]
    (printf "Hour: %s, Minute: %s, Second: %s"
            hour minute second)))
```

## Summary

In this blog post, we learnt how to represent data as values and extract them using destructuring. Just like how we extract values from string using regular expression, we are extracting the values from the data representation by recognizing the associative and the positional patterns. 