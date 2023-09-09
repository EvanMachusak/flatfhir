const duckdb = require('@duckdb/duckdb-wasm');
const path = require('path');
const Worker = require('web-worker');

// switch to master for left join support
// const DUCKDB_DIST = path.dirname(require.resolve('@duckdb/duckdb-wasm')); 
const DUCKDB_DIST = path.join(__dirname, "../ddb-dist/"); 

const mainModule = path.resolve(DUCKDB_DIST, './duckdb-eh.wasm');
const mainWorker = path.resolve(DUCKDB_DIST, './duckdb-node-eh.worker.cjs');

class DuckRunner {

	async openDB() {
		const logger = new duckdb.VoidLogger();
		const url =  new URL(mainWorker).pathname;
		this.worker = new Worker(url);
		this.db = new duckdb.AsyncDuckDB(logger, this.worker);
		await this.db.instantiate(mainModule);
		this.conn = await this.db.connect();
	}

	async dropAllTables() {
		const tables = await this.conn.query(`SHOW TABLES`);
		const query = tables.toArray().map(t => `DROP TABLE ${t.name};`).join("")
		await this.conn.query(query);
	}

	async loadResources(resources) {		
		const resourceTypes = [...new Set(resources.map( r => r.resourceType))];
		const loadResourceType = async resourceType => {
			const filteredResources = 
				resources.filter( r => r.resourceType = resourceType);
			await this.db.registerFileText(
				`${resourceType}.json`, JSON.stringify(filteredResources)
			);
			await this.conn.insertJSONFromPath(
				`${resourceType}.json`, {name: resourceType}
			);	
		}
		await Promise.all(resourceTypes.map(loadResourceType));
	}
	
	async runQuery(query) {
		try {
			const result = await this.conn.query(query);
			return result.toArray();
		} catch (e) {
			console.log("\n" + query + "\n");
			throw(e);
		}
	}

	async closeDB() {
		await this.conn.close();
		await this.db.terminate();
		await this.worker.terminate();
	} 
}

module.exports = DuckRunner;