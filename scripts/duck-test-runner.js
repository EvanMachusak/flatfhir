const DuckRunner = require("../src/duck-node-wasm");
const fs = require("fs");
const glob = require("glob");
const path = require('path'); 
const flatView = require("../src/flatview.js")
const definitions = require("../generated/abstract_r4.json");

const limitTestsTo = [];

async function executeTestFiles(files) {
	const runner = new DuckRunner();
	await runner.openDB();
	for (const file of files) {
		const json = fs.readFileSync(path.join(__dirname, file));
		const suite = JSON.parse(json);
		await executeTestSuite(suite, runner);
	}
	await runner.closeDB();
}

async function executeTestSuite(suite, runner) {
	console.log(`\n=== ${suite.title || suite.name} ===`)
	await runner.loadResources(suite.resources);
	for (const test of suite.tests) {
		if (limitTestsTo.length && limitTestsTo.indexOf(test.title) == -1)
			continue;
		if (suite.only && suite.only.indexOf(test.name) == -1)
			continue;
		if (suite.skip && suite.skip.indexOf(test.name) > -1)
			continue;
		await executeTest(test, runner);
	}
	await runner.dropAllTables();
}

async function executeTest(test, runner) {
	const fv = new flatView(definitions);
	fv.loadViewDefinition(test.view || test.viewDefinition);
	// console.log(JSON.stringify(fv.fields, null, 2));
	// console.log(JSON.stringify(fv.tables, null, 2));
	const query = fv.serializeForDuckDB();
	// console.log(query);
	//hack for deterministic results
	const sortedQuery = query + "\nORDER BY ALL ASC";
	const result = await runner.runQuery(sortedQuery);
	const success = JSON.stringify(result) == JSON.stringify(test.expect || test.result);
	if (success) {
		console.log("✅ " + (test.title || test.name));
	} else {
		console.log("❌ " + (tst.title || test.name));
		console.log("Actual:\n", result);
		console.log("SQL:\n", query)
	}
}

const testDirOrFile = process.argv.slice(2)[0] || "../tests/";
let files = [testDirOrFile];
if (fs.statSync(testDirOrFile).isDirectory()) {
	files = glob.globSync(
		path.join(testDirOrFile, "/**/test*.json").replaceAll('\\', '/'), 
		{ignore: "node_modules/**", dotRelative: true}
	);
}
executeTestFiles(files);