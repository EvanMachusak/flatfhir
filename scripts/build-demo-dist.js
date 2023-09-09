const fs = require("fs");
const path = require('path');

const sourceDirs = ["../src", "../demo", "../generated"];
const destDir = "../demo-dist";

if (!fs.existsSync(destDir)) 
	fs.mkdirSync(destDir);

sourceDirs.forEach( sourceDir => {
	const files = fs.readdirSync(sourceDir);
	files.forEach( file => {
		const sourceFilePath = path.join(sourceDir, file);
		const destFilePath = path.join(destDir, file);
		let content = fs.readFileSync(sourceFilePath, "utf-8");
		if (file.split(".").slice(-1) == "htm" || file.split(".").slice(-1) == "html")
			content = content
				.replace(/..\/src\//g, "")
				.replace(/..\/generated\//g, "");

		fs.writeFileSync(destFilePath, content);
	})
});