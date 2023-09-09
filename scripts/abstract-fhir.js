const path = require("path");
const fs = require("fs");

const jsonKeys = {
	type: "t",
	isArray: "a",
	referenceTargets: "rt",
	contentReference: "cr"
}

const includeReferenceTargets = false;
const formatOutputJson = false;

const abstractBundle = bundle => {
	let definitions = {};

	bundle.entry
		.filter( entry =>  entry.resource.resourceType == "StructureDefinition")
		.forEach( sd => {
			if (sd.resource.kind !== "complex-type" && sd.resource.kind !== "datatype" && sd.resource.kind !== "resource") return;

			//ignore profiled types (eg. SimpleQuantity) since will build the Quantity schema
			if (sd.resource.name !== sd.resource.type && sd.resource.type) return;

			if (sd.resource.kind === "resource") {
				//resourceType doesn't seem to be a field anywhere?
				definitions[sd.resource.name + ".resourceType"] = {[jsonKeys.type]: "string"};
				definitions[sd.resource.name] = {[jsonKeys.type]: sd.resource.name,  [jsonKeys.isArray]: true}
			}

			sd.resource.snapshot.element.forEach( elem => {

				if (!elem.type && elem.contentReference) {
					definitions[elem.path] = {
						[jsonKeys.type]: "ContentReference", 
						[jsonKeys.isArray]: elem.max !== "1" && elem.max !== "0", 
						[jsonKeys.contentReference]: elem.contentReference.slice(1)
					}
				}

				elem.type && elem.type.length && elem.type.forEach( type => {
					const path = elem.type.length === 1
						? elem.path
						: elem.path.replace("[x]", type.code[0].toUpperCase() + type.code.slice(1));
					const typeExtension = type.extension && 
						type.extension.find( ext => ext.url === "http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type");
					const outputType = typeExtension
						? typeExtension.valueUrl
						: type.code === "http://hl7.org/fhirpath/System.String" ? "string" : type.code;
					const isArray =  elem.max !== "1" && elem.max !== "0";
					const referenceTargets = type.targetProfile &&
						type.targetProfile.map( profile => profile.split("/")[profile.split("/").length-1] );
					definitions[path] = {[jsonKeys.type]: outputType, [jsonKeys.isArray]:isArray};
					if (includeReferenceTargets) definitions[path][jsonKeys.referenceTargets] = referenceTargets;
				});

			});
		});
	return definitions;
}


const fhirDir = process.argv.slice(2)[0] || "../fhir/R4";
const outputFile = process.argv.slice(2)[1] || "../generated/abstract_r4.json";

const resourceProfiles = fs.readFileSync(path.join(__dirname, fhirDir, "profiles-resources.json"), "utf-8");
const typeProfiles =  fs.readFileSync(path.join(__dirname, fhirDir, "profiles-types.json"), "utf-8");
const resourceDefinitions = abstractBundle(JSON.parse(resourceProfiles));
const typeDefinitions =  abstractBundle(JSON.parse(typeProfiles));
const definitions = Object.assign(resourceDefinitions, typeDefinitions); 
console.log("Generated: " + path.join(__dirname, outputFile));
fs.writeFileSync(path.join(__dirname, outputFile), JSON.stringify(definitions, null, formatOutputJson ? 2 : null));

