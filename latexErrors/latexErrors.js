// TeXworksScript
// Title: LaTeX errors
// Description: Looks for errors in the LaTeX terminal output
// Author: Jonathan Kew, Stefan Löffler, Henrik Skov Midtiby
// Version: 0.5
// Date: 2012-03-02
// Script-Type: hook
// Hook: AfterTypeset

// This is just a simple proof-of-concept; it will often get filenames wrong, for example.
// Switching the engines to use the FILE:LINE-style error messages could help a lot.

// NB: The AfterTypeset hook is always called from the TeXDocument, as
// the typesetting is handled there

function LatexErrorAnalyzer() {
	var obj = {};
	obj.analyzeLog = function()
	{
		obj.initializeParameters();
		obj.getLinesToAnalyze();
		obj.analyzeGatheredLines();
		obj.suggestToDeleteAuxFilesIfSpecificErrorIsSeen();
		obj.showFormattedOutput();
	}
	
	// Removes the filename (or the last foldername if path specifies a folder)
	function basename(path)
	{
		var i;
		i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
		if (i == -1)
			return path;
		return path.substr(0, i);
	}

	obj.initializeParameters = function()
	{
		this.parenRE = new RegExp("[()]");
		this.lineNumRE = new RegExp("^l\\.(\\d+)");
		this.badLineRE = new RegExp("^(?:Over|Under)full \\\\hbox.*at lines (\\d+)");
		this.warnLineRE = new RegExp("^(?:LaTeX|Package (?:.*)) Warning: .*");
		this.warnLineNumRE = new RegExp("on input line (\\d+).");
		this.latexmkApplyingRule = new RegExp("Latexmk: applying rule \'(.*)\'");
		this.errors = [];
		this.warnings = [];
		this.infos = [];
		this.curFile = undefined;
		this.filenames = [];
		this.extraParens = 0;
		this.rootPath = basename(TW.target.rootFileName);
	}

	
	obj.getLinesToAnalyze = function()
	{
		// get the text from the standard console output
		txt = TW.target.consoleOutput;
		this.lines = txt.split('\n');
	}

	obj.analyzeGatheredLines = function()
	{
		for (i = 0; i < this.lines.length; ++i) {
			line = this.lines[i];

			// check for error messages
			if (line.match("^! ")) {
				this.addErrorFromLine(line);
				continue;
			}

			// check for over- or underfull lines
			matched = this.badLineRE.exec(line);
			if (matched) {
				this.addInfoFromLine(line);
				continue;
			}

			// check for other warnings
			matched = this.warnLineRE.exec(line);
			if (matched) {
				this.checkForOtherWarnings(line);
				continue;
			}

			this.trackBeginningEndingOfInputFiles(line);

			this.checkForRerunOfLatex(line);
		}
	}


	obj.addErrorFromLine = function(line)
	{
		var error = [];
		// record the current input file
		error[0] = this.curFile;
		// record the error message itself
		error[2] = line;
		// look ahead for the line number and record that
		error[1] = 0;
		while (++i < this.lines.length) {
			line = this.lines[i];
			if(trim(line) == '') break;
			matched = this.lineNumRE.exec(line);
			if (matched)
				error[1] = matched[1];
			error[2] += "\n" + line;
		}
		this.errors.push(error);
	}

	function trim (zeichenkette) {
		return zeichenkette.replace (/^\s+/, '').replace (/\s+$/, '');
	}

	obj.addInfoFromLine = function(line)
	{
		var error = [];
		error[0] = this.curFile;
		error[1] = matched[1];
		error[2] = line;
		this.infos.push(error);
	}

	obj.checkForOtherWarnings = function(line)
	{
		var error = [];
		error[0] = this.curFile;
		error[1] = "?";
		error[2] = line;

		while (++i < this.lines.length) {
			line = this.lines[i];
			if(line == '') break;
			error[2] += "\n" + line;
		}
		matched = this.warnLineNumRE.exec(error[2].replace(/\n/, ""));
		if (matched)
			error[1] = matched[1];
		this.warnings.push(error);
	}
	
	function startsWith(haystack, needle) {
		if (haystack.length < needle)
			return false;
		return (haystack.substr(0, needle.length) == needle);
	}
	
	function pathMayExist(path) {
		return (TW.fileExists(path) != 1);
	}
	
	obj.matchNewFile = function(line)
	{
		// Note: upon entering this function, the parameter line is truncated so
		// that it starts at the initial paranthesis '('
		var quoted = false;
		var filepath = '';
		var prefix = '(';
		line = line.slice(1);
		
		var lineIdx = i;
		
		while (line.length == 0 && lineIdx < this.lines.length - 1)
			line += this.lines[++lineIdx];
		if (line.length == 0)
			return undefined;
		
		if (line[0] == '"') {
			quoted = true;
			line = line.slice(1);
			prefix += '"';
		}

		while (line.length < 2 && lineIdx < this.lines.length - 1)
			line += this.lines[++lineIdx];
	
		// File names may be:
		// 1) absolute (starting with something like 'C:', '/', '//', '\\', ...)
		// 2) relative (starting with './' (TL))
		var beginningRE = new RegExp("^([a-zA-Z]:(\\\\|/)|/|\\\\\\\\|\\.(\\\\|/))");
		if (!beginningRE.exec(line))
			return undefined;
		
		// Only TL seems to use relative paths, and it seems to prefix all paths
		// with './'.
		var isAbsolutePath = (line[0] != '.');
		
		if (!isAbsolutePath)
			filepath = this.rootPath + '/';
		
		// If we got here, we may indeed be looking at a path (i.e., it started
		// with a string characteristic of a path)
		var sepRE = new RegExp('[/\\ ")]');
		var match;
		while (lineIdx <= this.lines.length) {
			while ((match = sepRE.exec(line))) {
				var sepPos = line.indexOf(match[0]);
				filepath += line.substr(0, sepPos);
				line = line.slice(sepPos + 1);
				if (match[0] == '/' || match[0] == '\\') {
					// We found a new folder name; add it to filepath and see
					// if the folder exists
					filepath += match[0];
					if (!pathMayExist(filepath))
						return undefined;
				}
				else if (match[0] == ' ' || match[0] == '"' || match[0] == ')') {
					if ((!quoted || match[0] == '"') && pathMayExist(filepath)) {
						// We found a file that (possibly) exists, so we're done
						return [prefix + filepath + match[0], filepath];
					}
					filepath += match[0];
				}
			}
			// we have reached the end of the line; check if this marks the end
			// of the filename
			filepath += line;
			if (!quoted && pathMayExist(filepath)) {
				return [prefix + filepath, filepath];
			}
			lineIdx++;
			if (lineIdx < this.lines.length)
				line = this.lines[lineIdx];
		}
		
		// If we got here, we reached the end of the log
		return undefined;
	}

	obj.trackBeginningEndingOfInputFiles = function(line)
	{
		// try to track beginning/ending of input files (flaky!)
		pos = line.search(this.parenRE);
		while (pos >= 0) {
			line = line.slice(pos);
			if (line.charAt(0) == ")") {
				if (this.extraParens > 0) {
					--this.extraParens;
				}
				else if (this.filenames.length > 0) {
					this.curFile = this.filenames.pop();
				}
				line = line.slice(1);
			}
			else {
				match = this.matchNewFile(line);
				if (match) {
					this.filenames.push(this.curFile);
					this.curFile = match[1];
					line = line.slice(match[0].length);
					this.extraParens = 0;
				}
				else {
					++this.extraParens;
					line = line.slice(1);
				}
			}
			if (line == undefined) {
				break;
			}
			pos = line.search(this.parenRE);
		}
	}
	
	obj.checkForRerunOfLatex = function(line) {
		matched = this.latexmkApplyingRule.exec(line);
		if(matched)
		{
			this.resetWarningsInfosAndErrors();
		}
	}

	obj.resetWarningsInfosAndErrors = function() {
		this.warnings.length = 0;
		this.infos.length = 0;
		this.errors.length = 0;
	}

	function htmlize(str) {
		var html = str;
		html = html.replace(/&/g, "&amp;");
		html = html.replace(/</g, "&lt;");
		html = html.replace(/>/g, "&gt;");
		html = html.replace(/\n /g, "\n&nbsp;");
		html = html.replace(/  /g, "&nbsp;&nbsp;");
		html = html.replace(/&nbsp; /g, "&nbsp;&nbsp;");
		return html.replace(/\n/g, "<br />\n");

	}

	function makeResultRow(data, color) {
		var html = '';
		var url = 'texworks:' + data[0] + (data[1] != '?' && data[1] != 0 ? '#' + data[1] : '');
		html += '<tr>';
		html += '<td width="10" style="background-color: ' + color + '"></td>';
		html += '<td valign="top"><a href="' + url + '">' + data[0] + '</a></td>';
		html += '<td valign="top">' + data[1] + '</td>';
		html += '<td valign="top" style="font-family: monospace;">' + htmlize(data[2]) + '</td>';
		html += '</tr>';
		return html;
	}

	function showObject(inputObject)
	{
		var tempText = "";
		for(prop in inputObject){
			tempText += prop + " -> " + inputObject[prop] + "\n";
		}
		TW.information(null, "Hej", tempText);
	}

	obj.suggestToDeleteAuxFilesIfSpecificErrorIsSeen = function()
	{
		for (index in this.errors)
		{
			error = this.errors[index];

			if(error[2].indexOf("File ended while scanning use of") > -1)
			{
				TW.target.removeAuxFiles();
			}
		}
	}

	obj.showFormattedOutput = function()
	{
		// finally, return our result (if any)
		if (this.errors.length > 0 || this.warnings.length > 0 || this.infos.length > 0) {
			html  = '<html><body>';
			html += '<table border="1" cellspacing="0" cellpadding="4">';

			for(i = 0; i < this.errors.length; ++i)
				html += makeResultRow(this.errors[i], 'red');
			for(i = 0; i < this.warnings.length; ++i)
				html += makeResultRow(this.warnings[i], 'yellow');
			for(i = 0; i < this.infos.length; ++i)
				html += makeResultRow(this.infos[i], '#8080ff');

			html += "</table>";
			html += "</body></html>";
			TW.result = html;
		}
	}

	return(obj);
}

analyzer = LatexErrorAnalyzer();
analyzer.analyzeLog();


