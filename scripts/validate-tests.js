const fs = require("fs");
const path = require("path");
const glob = require("glob");
const Validator = require('jsonschema').Validator;

let v = new Validator();
const schema = JSON.parse(fs.readFileSync("tests.schema.json", "utf-8"));

const testDirOrFile = process.argv.slice(2)[0] || "../tests/";

let files = [testDirOrFile];
if (fs.statSync(testDirOrFile).isDirectory()) {
	files = glob.globSync(
		path.join(testDirOrFile, "/**/test*.json"), 
		{ignore: "node_modules/**"}
	);
}

files.forEach( file => {
	const json = fs.readFileSync(path.join(__dirname, file));
	const instance = JSON.parse(json);
	console.log(`Validating ${file}`)
	v.validate(instance, schema, {throwFirst: true});
})