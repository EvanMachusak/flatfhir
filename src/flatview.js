// const parser = require("./fp-subset-parser.js");
let parser;
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
	parser = require("../generated/fp-subset-parser.js");
} else if (typeof window !== 'undefined') {
	parser = window.parser;
}

class FlatView {

	constructor(definitions) {
		this.definitions = definitions || {};
		this.tables = [];
		this.fields = [];
		this.nextTableId = 0;
	}

	loadViewDefinition(viewDefinition) {

		const processSection = (section, pos, constants=[]) => {	
			function applyConst(expr) {
				constants.forEach( c => {
					expr = expr.replaceAll("%" + c.name, c.value);
				});
				return expr;
			}
	
			if (section.constants) constants = section.constants;
	
			if (section.resource)
				pos = this.addFhirPath(pos, applyConst(section.resource), null, true);
			if (section.expr || section.expression || section.path)
				this.addFhirPath(pos, applyConst(section.expr || section.expression || section.path), section.name);
			if (section.forEach)
				pos = this.addFhirPath(pos, applyConst(section.forEach), null, true);
			if (section.forEachOrNull)
				pos = this.addFhirPath(pos, applyConst(section.forEachOrNull), null, true, true);
			if (section.from)
				pos = this.addFhirPath(pos, applyConst(section.from), null, true);
			if (section.where) {
				const exprGroup =
					section.where.map(w => w.expr || w.expression || w.path).join(" AND ");
				this.addWhereCondition(pos, "where(" + applyConst(exprGroup) + ")");
			}
	
			if (section.select) section.select.forEach( item => {
				processSection(item, pos, constants)
			});
		}
		processSection(viewDefinition);	
		return this;	
	}

	addWhereCondition(parent, expression) {
		const ast = parser.parse(expression);
		const parentTableGroup = this.tables.find(tg => {
			return tg.tables.find( t => {
				return t.id = parent.t
			})
		});
		const newPath = this.addPathAst(ast, parent, parentTableGroup.tables.slice());
		parentTableGroup.tables = newPath.tables;
	}

	addFhirPath(parent, expression, alias, notInSelect, forceLeftJoin) {
		const ast = parser.parse(expression);
		// console.log(JSON.stringify(ast, null, 2))

		const {current, tables, leftJoin} = 
			this.addPathAst(ast, parent, [], forceLeftJoin);
		
		if (tables.length)
			this.tables.push({leftJoin, tables: tables});

		if (!notInSelect)
			this.fields.push({...current, alias});

		return current;
	}

	addPathAst(ast, parent, tables=[], leftJoin) {
		let current = parent
			? {t: parent.t, f: parent.f.slice(), fhirTypePath: parent.fhirTypePath.slice()} 
			: {t: null, f:[], fhirTypePath: []};

		ast.forEach( (item, i) => {
			if (item.type == "nav" && item.value != "$this") {
				let isArray = item.array;
	
				current.fhirTypePath = current.fhirTypePath.concat([item.value]);
				const pathDefinition = this.definitions[current.fhirTypePath.join(".")];
				if (pathDefinition) {
					if (pathDefinition.contentReference) {
						current.fhirTypePath = [pathDefinition.cr];
					} else if (
						pathDefinition.t !== "BackboneElement" && 
						pathDefinition.t !== "Element" && 
						pathDefinition.t[0] === pathDefinition.t[0].toUpperCase()
					) {
						current.fhirTypePath = [pathDefinition.t];
					}
					isArray = item.array || pathDefinition.a;
					current.fhirType = pathDefinition.t;
				}

				//path ends in a function - apply fn to field
				const hasTerminalFunction = i == ast.length-2 &&
					(ast[i+1].type == "join()" || ast[i+1].type == "fn");

				if (!isArray || hasTerminalFunction) {
					current.f.push(item.value)
				} else {
					this.nextTableId++;
					const tId = item.value +"_" + this.nextTableId;
					let criteria = item.value == "extension" && item.url
						? [{t: tId, f: ["url"], "fhirType": "uri"}, "='" + item.url + "'"]
						: [];
					tables.push({
						parent: {id: current.id, t: current.t, f: current.f.slice()},
						id: tId, name: item.value, criteria, fhirType: current.fhirType
					});
					current = {t: tId, f:[], fhirTypePath: current.fhirTypePath};
				}
	
			} else if (item.type == "where" || item.type == "exists") {
				const newCriteria = this.addCriteria(item.criteria, current, tables.slice());
				if (newCriteria) {
					tables = newCriteria.tables;
					const table = tables.find(t => t.id == current.t);
					table.criteria = table.criteria.concat(newCriteria.criteria);
				}
			
			// function on a table - first(), exists(), empty()
			} else if (item.type == "fn" && !current.f.length) {
				const table = tables.find(t => t.id == current.t);
				table.fn = item.name;
		
			// function on a field - getId(), getIdType(), first()
			} else if (item.type == "fn" && current.f.length) {
				current.fnName = item.name;
				leftJoin = true;
			
			// join function - table aggregate on a field
			} else if (item.type == "join()") {
				current.fnName = "join()";
				current.fnValue = item.value;

			}
		});
		return {current, tables, leftJoin};
	}

	addCriteria(ast, parent, tables) {
		if (ast.type == "comparison") {
			const criteriaPath = this.addPathAst(ast.path, parent, tables)
			return {
				criteria: [criteriaPath.current, " " + ast.comparator + " " + ast.value].flat(),
				tables: criteriaPath.tables
			}
	
		} else if (ast.type == "path") {
			const criteriaPath = this.addPathAst(ast.path, parent, tables);
			const hasFn = criteriaPath.current.fnName
			return {
				//only include path as criteria if there's a function on it
				criteria: hasFn ? [criteriaPath.current] : [],
				tables: criteriaPath.tables
			}
		} else if (ast.type == "criteria_group") {
			const newCriteria = this.addCriteria(ast.criteria, parent, tables);
			return {
				criteria: ["(", newCriteria.criteria, ")"].flat(),
				tables: newCriteria.tables
			}
	
		} else if (ast.type == "criteria_and" || ast.type == "criteria_or") {
			const currentLeft = this.addCriteria(ast.left, parent, tables);
			const currentRight = this.addCriteria(ast.right, parent, currentLeft.tables);
			return {
				criteria: [
						currentLeft.criteria,
						ast.type == "criteria_or" ? " OR " : " AND ",
						currentRight.criteria
					].flat(),
				tables: currentRight.tables
			}
		}
	}

	serializeForDuckDB() {
		function fieldExpressionToSql(field) {
			let sql = [field.t];

			if (field.f.length)
				sql.push("." + field.f.join("."));

			if (field.fnName == "getId()") {
				sql.unshift("split_part(")
				sql.push(".reference,'/',-1)")
			} else if (field.fnName == "getIdType()") {
				sql.unshift("split_part(")
				sql.push(".reference,'/',-2)")
			} else if (field.fnName== "exists()") {
				sql.push(" IS NOT NULL")
			} else if (field.fnName == "empty()") {
				sql.push(" IS NULL")
			} else if (field.fnName == "join()") {
				sql.unshift("array_to_string(");
				sql.push(",", field.fnValue, ")");
			} else if (field.fnName == "first()") {
				sql.push("[1]");
			}
			if (field.alias)
				sql.push(" AS " + field.alias);
			return sql.join("")
		}

		function tablePathToSql(table) {
			let sql = [table.parent.t];
			if (table.parent.f.length) 
				sql.push(table.parent.f);
			sql.push(table.name);
			return sql.join(".");
		}
		function tableGroupToSql(tableGroup) {
			let groupSqlWhere = [];
			let groupSqlJoin = [];
			let groupSqlUnnest = [];
			let groupSqlLimit;
			tableGroup.tables.forEach( table => {
				if (!table.parent.t) {
					groupSqlJoin.push(table.name  + " AS " + table.id);
				} else {
					let sql = [];
					sql.push("UNNEST(");
					sql.push(tablePathToSql(table));
					sql.push(")");
					sql.push(" AS t_" + table.id + "(" + table.id + ")");
					groupSqlUnnest.push(sql.join(""));
				}

				if (table.fn && table.fn.indexOf("first()") > -1)
					groupSqlLimit = "LIMIT 1"

				const criteria = table.criteria.map( c => {
					return typeof c === 'string'
						? c
						: fieldExpressionToSql(c);
				});
				if (criteria.length) 
					groupSqlWhere.push(criteria.join(""));

			});
			return {groupSqlWhere, groupSqlJoin, groupSqlUnnest, groupSqlLimit};
		} 

		function buildSqlStatement(select, fromJoin, fromUnnest, where, limit=null, indent="") {
			let sql = [indent + "SELECT"]
			sql.push(select.length > 1 ? "\n" : " ");
			sql.push(select.join(",\n" + indent));
			sql.push("\n" + indent + "FROM\n");
			if (fromJoin.length)
				sql.push(indent + fromJoin.join("\n" + indent));
			if (fromJoin.length && fromUnnest.length)
				sql.push(",\n");
			if (fromUnnest.length)
				sql.push(indent + fromUnnest.join(",\n" + indent));
			if (where.length)
				sql.push("\n" + indent + "WHERE\n" + indent, where.join("\n" + indent + "AND "));
			if (limit)
				sql.push("\n", indent + limit);
			return sql.join("");
		}

		const sqlSelect = 
			this.fields.map(fieldExpressionToSql);

		let sqlWhere = [];
		let sqlJoin = [];
		let sqlUnnest = [];

		this.tables.forEach( tableGroup => {
			const {
				groupSqlWhere, groupSqlJoin, groupSqlUnnest, groupSqlLimit
			} = tableGroupToSql(tableGroup);

			if (groupSqlLimit) {
				let sql = buildSqlStatement(
					["*"], 
					groupSqlJoin, groupSqlUnnest, 
					groupSqlWhere, groupSqlLimit,
					"  "
				)
				if (tableGroup.leftJoin) {
					sqlJoin.push("LEFT JOIN (\n" + sql + "\n) ON TRUE");
				} else {
					sqlJoin.push("JOIN (\n" + sql + "\n) ON TRUE");
				}			
			} else {
				sqlJoin = sqlJoin.concat(groupSqlJoin);
				if (tableGroup.leftJoin) {
					sqlJoin = sqlJoin.concat(groupSqlUnnest.map( sql => {
						return "LEFT JOIN " + sql + " ON TRUE"
					}));
				} else {
					sqlUnnest = sqlUnnest.concat(groupSqlUnnest);
				}
				sqlWhere = sqlWhere.concat(groupSqlWhere);
			}
		});

		return buildSqlStatement(
			sqlSelect, sqlJoin, sqlUnnest, sqlWhere
		)
	}
}


if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
	module.exports = FlatView;
} else if (typeof window !== 'undefined') {
	window.FlatView = FlatView;
}
