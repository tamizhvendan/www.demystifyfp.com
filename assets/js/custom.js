var level = 0;
Prism.hooks.add('wrap', function (env) {
  if (env.language == "clojure" && env.type == "punctuation") {
    if (env.content == "(" || env.content == "[" || env.content == "{") {
      level++;
      env.classes.push("rbl" + level);
    }
    if (env.content == ")" || env.content == "]" || env.content == "}") {
      env.classes.push("rbl" + level);
      level--;
    }
  }
});
