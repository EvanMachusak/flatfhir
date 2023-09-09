const fs = require("fs");
const peg = require("pegjs");

const grammar = fs.readFileSync("../src/fp-subset.peg", "utf-8");
const parser = peg.generate(grammar, {output: "source", format: "umd", exportVar: "parser"});
//const parser = peg.generate(grammar, {output: "source", format: "commonjs"});
fs.writeFileSync("../generated/fp-subset-parser.js", parser);