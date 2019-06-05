class PDF2Text {
	constructor() {
		this.complete = 0;
	}
	/**
	 *
	 * @param data ArrayBuffer of the pdf file content
	 * @param callbackPageDone To inform the progress each time
	 *        when a page is finished. The callback function's input parameters are:
	 *        1) number of pages done;
	 *        2) total number of pages in file.
	 * @param callbackAllDone The input parameter of callback function is
	 *        the result of extracted text from pdf file.
	 *
	 */
	convert(data, parser) {
		console.assert(data instanceof ArrayBuffer || typeof data == "string");
		return new Promise((resolve, reject) => {
			pdfjsLib
				.getDocument(data)
				.then(data => PDF2Text.parsePDF(this, data, parser))
				.then(resolve)
				.catch(reject);
		});
	}
	static parsePDF(self, pdf, parser) {
		DOMUtility.displayProgress("Parsing File");
		return new Promise((resolve, reject) => {
			var total = pdf.numPages;
			var layers = {};
			var raw_layers = {};
			for (var i = 1; i <= total; i++) {
				// PAGES ARE LOADING IN REVERSE ORDER!
				pdf.getPage(i).then(function(page) {
					var n = page.pageNumber;
					raw_layers[n] = [];
					page.getTextContent().then(function(textContent) {
						if (textContent.items != null) {
							var page_text = "";
							var last_block = null;
							for (var k = 0; k < textContent.items.length; k++) {
								var block = textContent.items[k];
								if (
									last_block != null &&
									last_block.str[last_block.str.length - 1] != " "
								) {
									if (block.x < last_block.x) page_text += "\r\n";
									else if (
										last_block.y != block.y &&
										last_block.str.match(/^(\s?[a-zA-Z])$|^(.+\s[a-zA-Z])$/) == null
									)
										page_text += " ";
								}
								page_text += block.str;
								raw_layers[n].push(block.str);
								last_block = block;
							}

							layers[n] = page_text + "\n\n";
						}
						++self.complete;
						if (self.complete == total) {
							window.setTimeout(function() {
								var num_pages = Object.keys(layers).length;
								if (parser) {
									for (var j = 1; j <= num_pages; j++)
										for (var k = 0; k < raw_layers[j].length; k++)
											parser.read(raw_layers[j][k]);
									try{
										resolve(parser.parse());
									} catch(err) {
										reject(err);
									}
								} else {
									var full_text = "";
									for (var j = 1; j <= num_pages; j++) full_text += layers[j];
									resolve(full_text);
								}
							}, 1000);
						}
					}); // end  of page.getTextContent().then
				});
			}
		});
	}
	static inputToPDF(elem) {
		DOMUtility.displayProgress("Reading File");
		return new Promise((resolve, reject) => {
			if (elem.files.length === 0)
				reject(
					"No file was inputted. Please input a pdf transcript using the instructions above."
				);
			var inputted_file = elem.files[0];
			// var hasPDFFileEnding = inputted_file.name.endsWith(".pdf");
			var hasPDFMimeType = inputted_file.type.includes("pdf"); //-ish
			var hasUnknownMimeType = inputted_file.type == "";

			if (!(hasPDFMimeType || hasUnknownMimeType)) {
				var err = "File doesn't seem like a PDF, so it was not parsed.";
				console.error(err);
				return reject(err);
			}
			var reader = new FileReader();
			reader.addEventListener("loadstart", e => {
				console.log(`Parsing PDF File "${inputted_file.name}" ....`);
			});
			reader.addEventListener("load", e => {
				console.log(`PDF File "${inputted_file.name}" has been parsed`);
				resolve(e.target.result);
			});
			reader.addEventListener("error", e => {
				console.log(`There was an error parsing the file "${inputted_file.name}"`);
				reject(e.target.error);
			});
			reader.readAsArrayBuffer(inputted_file);
		});
	}
	static loadPDFFile(sourceId, parser) {
		DOMUtility.displayProgress("Loading File");
		return this.inputToPDF(document.getElementById(sourceId)).then(arrayBuffer =>
			new PDF2Text().convert(arrayBuffer, parser)
		);
	}
}
class GPACalculator {
	/**
	 * Parses the UWaterloo unofficial undergraduate transcript
	 * A modified version of the parser written for UWFlow found here:
	 * https://github.com/UWFlow/rmc/blob/master/server/static/js/transcript.js
	 */
	static parseText(data) {
		return new Promise((resolve, reject) => {
			var beginMarker = "Undergraduate Unofficial Transcript";
			var endMarker = "End of Undergraduate Unofficial Transcript";

			var beginIndex = data.indexOf(beginMarker);
			if (beginIndex !== -1) {
				beginIndex += beginMarker.length;
			}

			var endIndex = data.indexOf(endMarker);
			if (endIndex === -1) {
				endIndex = data.length;
			}

			// Set portion of transcript that we care about to be between
			// begin and end markers
			data = data.substring(beginIndex, endIndex);
			var matches = data.match(/Student ID:\s*(\d+)/);
			var studentId;
			if (matches) {
				studentId = parseInt(matches[1], 10);
			} else {
				return reject(
					"Couldn't find Student ID in Transcript. Verify this is actually a transcript PDF ..."
				);
			}
			matches = data.match(/Program:\s*(.*?)\s*Level:/);
			if (matches) {
				var programName = matches[1].trim();
			} else {
				return reject(
					"Couldn't find Program in Transcript. Verify this is actually a transcript PDF ..."
				);
			}

			var termsRaw = [];

			var termRe = /Spring|Fall|Winter/g;
			var match = termRe.exec(data);
			var lastIndex = -1;
			// Split the transcript by terms
			while (match) {
				if (lastIndex !== -1) {
					var termRaw = data.substring(lastIndex, match.index);
					termsRaw.push(termRaw);
				}
				lastIndex = match.index;
				match = termRe.exec(data);
			}
			if (lastIndex > -1) {
				termsRaw.push(data.substring(lastIndex));
			}
			var coursesByTerm = [];
			// Parse out the term and courses taken in that term
			termsRaw.forEach(function(termRaw, i) {
				var termMatch = termRaw.match(/(?:Spring|Fall|Winter) \d{4}/);
				var programYearMatch = termRaw.match(/Level:\s+(\d[A-B]|NL)\s*(?:Load:)/);
				if (!(termMatch && programYearMatch)) {
					// This could happen for a term that is a transfer from another school
					return;
				}

				var termName = termMatch[0];
				var programYearId = programYearMatch[1];
				termRaw = termRaw.substring(termName.length);

				var termLines = termRaw.split(/\r\n|\r|\n/g);
				var courses = [];
				termLines.forEach(function(termLine) {
					// Assumption is that course codes that identify courses you've taken
					// should only appear at the beginning of a line
					matches = termLine.match(
						/^(\s*[A-Z]+ \d{3}[A-Z]?).+(\d+\.\d+\/\d+\.\d+\s[\s\w\d\/\.]+)$/
					);
					if (!matches || !matches.length) {
						return;
					}
					var course = matches[1];
					var details = matches[2].split(/\s+/);
					var grade = parseInt(details[1]);
					var weight = parseFloat(details[0].split("/")[0]);
					var credit = details[2] == "Y";
					var inGpa = details[3] == "Y";
					var gpa = inGpa ? this.percentToGPA(grade) : "N/A";

					courses.push({
						course: course,
						grade: grade,
						weight: weight,
						credit: credit,
						inGpa: inGpa,
						gpa: gpa
					});
				});

				var sumWeightedGpa = 0;
				var sumCredits = 0;
				courses.forEach(function(course) {
					if (course.inGpa) {
						sumWeightedGpa += course.gpa * course.weight;
						sumCredits += course.weight;
					}
				});
				var termGpa = sumCredits != 0 ? sumWeightedGpa / sumCredits : 0;

				coursesByTerm.push({
					name: termName,
					programYearId: programYearId,
					courses: courses,
					sumWeightedGpa: sumWeightedGpa,
					sumCredits: sumCredits,
					gpa: termGpa
				});
			});
			var totalWeightedGpa = GPACalculator.sumUpCourseField(
				coursesByTerm,
				"sumWeightedGpa"
			);
			var totalCredits = GPACalculator.sumUpCourseField(
				coursesByTerm,
				"sumCredits"
			);
			var cGpa = totalCredits != 0 ? totalWeightedGpa / totalCredits : 0;

			resolve({
				coursesByTerm: coursesByTerm,
				studentId: studentId,
				programName: programName,
				cGpa: cGpa
			});
		});
	}

	/**
	 * Converts a percentage into GPA using the following scale:
	 * https://www.ouac.on.ca/guide/omsas-conversion-table/
	 */
	static percentToGPA(percent) {
		if (percent >= 90) return 4.0;
		else if (percent >= 85) return 3.9;
		else if (percent >= 80) return 3.7;
		else if (percent >= 77) return 3.3;
		else if (percent >= 73) return 3.0;
		else if (percent >= 70) return 2.7;
		else if (percent >= 67) return 2.3;
		else if (percent >= 63) return 2.0;
		else if (percent >= 60) return 1.7;
		else if (percent >= 57) return 1.3;
		else if (percent >= 53) return 1.0;
		else if (percent >= 50) return 0.7;
		else return 0;
	}

	/**
	 * Sums up a given field in coursesByTerm.
	 */
	static sumUpCourseField(coursesByTerm, field) {
		var add = function(a, b) {
			return a + b;
		};
		var fieldByTerm = coursesByTerm.map(function(x) {
			return x[field];
		});
		return fieldByTerm.reduce(add, 0);
	}

	/**
	 * Runs the parser on the data in the element with ID sourceId
	 * and populates the element with ID resultId.
	 */
	static populateGPA(sourceId, resultId) {
		var display = "";
		var parser = new TranscriptParser();
		PDF2Text.loadPDFFile(sourceId, parser)
			.then(details => DOMUtility.displayDetails(details, resultId))
			.catch(err => DOMUtility.displayError(err, resultId));
	}
}
class TranscriptParser {
	constructor(output) {
		this.output = output || {
			coursesByTerm: [],
			studentId: null,
			programName: null,
			cGpa: 0
		};
		this.states = Object.freeze({
			WAITING: 0,
			STUDENT_INFO: 1,
			STUDENT_NAME: 2,
			STUDENT_ID: 3,
			OEN: 4,
			START_TERM: 5,
			PROGRAM: 6,
			STATUS: 7,
			COURSE_NAME: 8,
			COURSE_CODE: 9,
			COURSE_DESC: 10,
			CREDIT_ATTEMPT: 11,
			CREDIT_EARNED: 12,
			CREDIT_GRADE: 13,
			TERM_GPA: 14,
			TERM_TOTAL_IN_GPA: 15,
			TERM_TOTAL_EARNED: 16,
			CUMULATIVE_GPA: 17,
			CUMULATIVE_TOTAL_IN_GPA: 18,
			CUMULATIVE_TOTAL_EARNED: 19,
			ACADEMIC_STANDING: 20,
			HONOURS: 21,
			MILESTONES: 22,
			MILESTONE_DATE: 23,
			MILESTONE_DESC: 24,
			MILESTONE_STATUS: 25,
			SCHOLARSHIPS: 26,
			SCHOLARSHIP_DATE: 27,
			SCHOLARSHIP_DESC: 28,
			DONE: 29
		});
		this.state = this.states.WAITING;
		this.paused = false;
		this.transcriptInfo = {
			studentName: "",
			studentId: 0,
			studentOEN: 0,
			termInfo: [] //[TermInfo,...]
		};
		this.termCount = 0;
		this.courseCount = 0;
		/*** 
		TermInfo =>
		{
			termString: string
			program: string
			level: string
			load: string
			studyTerm: bool
			workTerm: bool
			courses: [CourseInfo, ...],
			gpa: number,
			term_total_credits: number,
			term_earned_credits: number,
			cumulative_gpa: number,
			cumulative_total_credits: number,
			cumulative_earned_credits: number
			academic_standing:
			honours: string
		}
		CourseInfo =>
		{
			id: string,
			description: string,
			other_info: string,
			credit_worth: number,
			credit_earned: number,
			grade: string,
			numeric_grade: number,
			in_average: boolean
		}
		***/
	}
	read(chunk) {
		var reMatches = null;
		switch (this.state) {
			case this.states.WAITING:
				if (chunk.includes("Undergraduate Unofficial Transcript"))
					this.state = this.states.STUDENT_INFO;
				break;
			case this.states.STUDENT_INFO:
				reMatches = chunk.match(/Name:\s*(.*)$/);
				if (reMatches) {
					this.transcriptInfo.studentName = reMatches[1];
				} else {
					throw Error("Expected student name ... got something else");
				}
				this.state = this.states.STUDENT_ID;
				break;
			case this.states.STUDENT_ID:
				reMatches = chunk.match(/Student ID:\s*(\d+)/);
				if (reMatches) {
					this.transcriptInfo.studentId = parseInt(reMatches[1], 10);
				} else {
					throw Error("Expected Student ID ... got something else");
				}

				this.state++;
				break;
			case this.states.OEN:
				reMatches = chunk.match(/Ontario Education Nbr:\s*(\d+)$/);
				if (reMatches) {
					this.transcriptInfo.studentOEN = parseInt(reMatches[1], 10);
				} else {
					throw Error("Expected Student OEN ... got something else");
				}
				this.state++;
				break;
			case this.states.START_TERM:
				reMatches = chunk.match(/(?:Fall|Winter|Spring) \d{4}/);
				if (reMatches) {
					this.transcriptInfo.termInfo.push({
						termString: reMatches[0],
						program: "",
						level: "",
						load: "",
						studyTerm: false,
						workTerm: false,
						courses: [],
						gpa: 0,
						term_total_credits: 0,
						term_earned_credits: 0,
						cumulative_gpa: 0,
						cumulative_total_credits: 0,
						cumulative_earned_credits: 0,
						academic_standing: "",
						honours: "",
						milestones: []
					});
					this.termCount++;
					this.courseCount = 0;
					this.state++;
				} else {
					if (chunk == "Milestones") this.state = this.states.MILESTONES;
					else if (chunk == "Scholarships and Awards")
						this.state = this.states.SCHOLARSHIPS;
					else if (chunk == "End of Undergraduate Unofficial Transcript")
						this.state = this.states.DONE;
				}
				break;
			case this.states.PROGRAM:
				var tC = this.termCount;
				reMatches = chunk.match(/Program:\s*(.*)/);
				if (reMatches) {
					this.transcriptInfo.termInfo[tC - 1].program += reMatches[1];
				} else {
					reMatches = chunk.includes("Level:");
					if (reMatches) {
						this.state++;
						this.read(chunk);
					} else {
						this.transcriptInfo.termInfo[tC - 1].program += " " + chunk;
					}
				}
				break;

			case this.states.STATUS:
				var tC = this.termCount;
				reMatches = chunk.match(
					/Level:\s+(\d[A-B]|NL)\s*Load:\s+([\w-]*)\s*Form Of Study:\s+(\w*)/
				);
				if (reMatches) {
					this.transcriptInfo.termInfo[tC - 1].level = reMatches[1];
					this.transcriptInfo.termInfo[tC - 1].load = reMatches[2];
					if (reMatches[3].includes("Co-op WorkTerm")) {
						this.transcriptInfo.termInfo[tC - 1].workTerm = true;
					} else if (reMatches[3].includes("Enrollment")) {
						this.transcriptInfo.termInfo[tC - 1].studyTerm = true;
					}
				}
				this.state++;
				this.paused = true;
				break;
			case this.states.COURSE_NAME:
				var tC = this.termCount;
				if (this.paused && chunk != "Grade") {
					break;
				} else if (this.paused) {
					this.paused = false;
					break;
				}
				console.log("COURSE_NAME", chunk);
				this.transcriptInfo.termInfo[tC - 1].courses.push({
					id: "",
					description: "",
					other_info: "",
					credit_worth: 0,
					credit_earned: 0,
					grade: "",
					numeric_grade: 0,
					in_average: true
				});
				this.courseCount++;
				var cC = this.courseCount;

				this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].id += chunk.trim();
				this.state++;
				break;
			case this.states.COURSE_CODE:
				var tC = this.termCount;
				var cC = this.courseCount;
				this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].id += chunk;
				this.state++;
				break;
			case this.states.COURSE_DESC:
				var tC = this.termCount;
				var cC = this.courseCount;
				this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].description = chunk;
				if (chunk.includes("Not in Avg"))
					this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].in_average = false;
				this.state++;
				if (!isNaN(chunk)) this.read(chunk);
				break;
			case this.states.CREDIT_ATTEMPT:
				var tC = this.termCount;
				var cC = this.courseCount;
				if (!isNaN(chunk)) {
					this.transcriptInfo.termInfo[tC - 1].courses[
						cC - 1
					].credit_worth = parseFloat(chunk);
				}
				this.state++;
				if (isNaN(chunk)) this.read(chunk);
				break;

			case this.states.CREDIT_EARNED:
				var tC = this.termCount;
				var cC = this.courseCount;
				if (!isNaN(chunk)) {
					this.transcriptInfo.termInfo[tC - 1].courses[
						cC - 1
					].credit_earned = parseFloat(chunk);
				}
				this.state++;
				if (isNaN(chunk)) this.read(chunk);
				break;

			case this.states.CREDIT_GRADE:
				var tC = this.termCount;
				var cC = this.courseCount;
				if (!isNaN(chunk) || chunk == "CR") {
					this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].grade = chunk;
					this.transcriptInfo.termInfo[tC - 1].courses[
						cC - 1
					].numeric_grade = parseFloat(chunk);
					if (chunk == "CR")
						this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].in_average = false;
				} else if (isNaN(chunk)) {
					if (chunk.toUpperCase() == chunk) {
						this.state = this.states.COURSE_NAME;
						this.read(chunk);
					} else if (chunk == "In GPA") {
						this.state++;
						this.paused = true;
						this.read(chunk);
					} else if (chunk == "Milestones") {
						this.state = this.states.MILESTONES;
						this.read(chunk);
					} else if (chunk == "Scholarships and Awards") {
						this.state = this.states.SCHOLARSHIPS;
						this.read(chunk);
					} else if (chunk == "End of Undergraduate Unofficial Transcript") {
						this.state = this.states.DONE;
						this.read(chunk);
					} else {
						this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].description +=
							" " + chunk.trim();
						if (chunk.includes("Not in Avg"))
							this.transcriptInfo.termInfo[tC - 1].courses[cC - 1].in_average = false;
						// don't change the state ...
					}
				}
				break;
			case this.states.TERM_GPA:
				var tC = this.termCount;
				if (this.paused && chunk != "Term GPA") {
					break;
				} else if (this.paused) {
					this.paused = false;
					break;
				}
				if (isNaN(chunk)) break;
				this.transcriptInfo.termInfo[tC - 1].gpa = parseFloat(chunk);
				this.state++;
				break;
			case this.states.TERM_TOTAL_IN_GPA:
				var tC = this.termCount;
				if (isNaN(chunk)) break;
				this.transcriptInfo.termInfo[tC - 1].term_total_credits = parseFloat(chunk);
				this.state++;
				break;
			case this.states.TERM_TOTAL_EARNED:
				var tC = this.termCount;
				if (isNaN(chunk)) break;
				this.transcriptInfo.termInfo[tC - 1].term_earned_credits = parseFloat(
					chunk
				);
				this.state++;
				break;
			case this.states.CUMULATIVE_GPA:
				var tC = this.termCount;
				if (isNaN(chunk)) break;
				this.transcriptInfo.termInfo[tC - 1].cumulative_gpa = parseFloat(chunk);
				this.state++;
				break;
			case this.states.CUMULATIVE_TOTAL_IN_GPA:
				var tC = this.termCount;
				if (isNaN(chunk)) break;
				this.transcriptInfo.termInfo[tC - 1].cumulative_total_credits = parseFloat(
					chunk
				);
				this.state++;
				break;
			case this.states.CUMULATIVE_TOTAL_EARNED:
				var tC = this.termCount;
				if (!isNaN(chunk)) {
					this.transcriptInfo.termInfo[
						tC - 1
					].cumulative_earned_credits = parseFloat(chunk);
				} else if (chunk.includes("Academic Standing")) {
					this.state++;
					this.read(chunk);
				} else {
					this.state = this.states.START_TERM;
					this.read(chunk);
				}
				break;
			case this.states.ACADEMIC_STANDING:
				var tC = this.termCount;
				reMatches = chunk.match(/Academic Standing: (\w+)/);
				if (reMatches) {
					this.transcriptInfo.termInfo[tC - 1].academic_standing = reMatches[1];
				} else if (chunk.trim() === "") {
					this.state = this.states.START_TERM;
				} else {
					reMatches = chunk.match(/Effective \d{2}\/\d{2}\/\d{4}/);
					if (reMatches) {
						this.state = this.states.START_TERM; // don't increment until the  effecitive date is parsed
					}
				}
				break;

			case this.states.HONOURS:
				var tC = this.termCount;
				reMatches = chunk.match(/Term Honours: (\w*)/);
				if (reMatches) {
					this.transcriptInfo.termInfo[tC - 1].honours = reMatches[1];
				} else {
					reMatches = chunk.match(/Effective \d{2}\/\d{2}\/\d{4}/);
					if (reMatches) {
						this.state = this.states.START_TERM; // don't increment until the  effecitive date is parsed
					}
				}
				break;
			default:
				console.log(this.state, "ignoring", chunk);
				this.state = this.states.DONE;
		}
	}
	parse() {
		console.log(this.state);
		if (this.state == this.states.DONE) {
			this.output.studentId = this.transcriptInfo.studentId;
			if (this.transcriptInfo.termInfo.length) {
				this.output.programName = this.transcriptInfo.termInfo[0].program;
			}
			var totalWeightedGpa = 0,
				totalCredits = 0,
				cGpa = 0,
				lastGPA = 0;
			console.log(totalCredits, cGpa);
			this.transcriptInfo.termInfo.forEach(term => {
				var sumWeightedGpa = 0;
				var sumCredits = 0;
				var courses = term.courses.map(course => {
					var course_info = {
						course: course.id,
						grade: course.numeric_grade || 0,
						weight: course.credit_worth,
						inGpa: course.in_average,
						gpa: course.in_average
							? GPACalculator.percentToGPA(course.numeric_grade)
							: "N/A"
					};
					if (course_info.inGpa) {
						sumWeightedGpa += course_info.gpa * course_info.weight;
						sumCredits += course_info.weight;
					}
					return course_info;
				});
				var termGpa = sumCredits != 0 ? sumWeightedGpa / sumCredits : 0; // should use this over transcript one because it's calculated differently...
				this.output.coursesByTerm.push({
					name: term.level,
					programYearId: term.termString,
					courses: courses,
					sumWeightedGpa: sumWeightedGpa,
					sumCredits: sumCredits,
					gpa: termGpa //GPACalculator.percentToGPA(term.gpa)
				});

				totalWeightedGpa += sumWeightedGpa;
				totalCredits += sumCredits;
				if (term.cumulative_gpa)
					this.output.cGpa = GPACalculator.percentToGPA(term.cumulative_gpa);
			});
			this.output.cGpa = totalCredits != 0 ? totalWeightedGpa / totalCredits : 0; //it's different than converting the term avg...
			console.log(totalCredits, cGpa);
			console.log(this.output);
			return this.output;
		}
		throw Error(
			"Parsed file was not a transcript file."
		);
	}
}
class DOMUtility {
	static toDOM(strHTML) {
		return document.createRange().createContextualFragment(strHTML);
	}
	static removeAllChildren(node) {
		while (node.hasChildNodes()) {
			node.removeChild(node.lastChild);
		}
	}
	static displayHTMLText(displayText, resultId) {
		var resultElement = document.getElementById(resultId);
		this.removeAllChildren(resultElement);
		resultElement.appendChild(this.toDOM(displayText));
	}
	static displayProgress(state) {
		this.displayHTMLText(`
		<div class="current-progress">
			Currently <span class="current-state">${state}</span>, your GPA should be fully calculated soon ...
		</div>`, "result");
	}
	static displayDetails(details, resultId) {
		var display = `<div	class="total-gpa">Your cumulative GPA is: ${details.cGpa.toFixed(3)} </div>
										 <table>
											 <tr>
												 <td>Student ID: </td>
												 <td>${details.studentId}</td>
											 </tr>
											 <tr>
												 <td>Program: </td>
												 <td>${details.programName}</td>
											 </tr>
										 </table>`;

		details.coursesByTerm.forEach(function(term) {
			if (term.sumCredits != 0) {
				display += `<hr>
											<h3>${term.programYearId} - ${term.name}</h3>
											<table class='term-table'>
												<col><col><col><col><col>
												<thead>
													<th>Course</th>
													<th>Percent</th>
													<th>Weight</th>
													<th>GPA</th>
													<th>In GPA?</th>
												</thead>`;
				term.courses.forEach(function(course) {
					display += `<tr>
													<td> ${course.course} </td>
													<td> ${course.grade || "N/A"}</td>
													<td> ${
														typeof course.weight == "number"
															? course.weight.toFixed(2)
															: course.weight
													} </td>
													<td>${typeof course.gpa == "number" ? course.gpa.toFixed(2) : course.gpa}</td>
													<td> ${course.inGpa ? "Y" : "N"} </td>
												</tr>`;
				});
				display += `</table>
											<div class='term-gpa'>Term GPA: ${term.gpa.toFixed(3)}</div>`;
			}
		});
		this.displayHTMLText(display, resultId);
	}
	static displayError(error, resultId) {
		console.error(error);
		this.displayHTMLText(
			`<p class="err_response">
									An error has occured while parsing your transcript. 
									Verify that the uploaded PDF is the transcript ...
								</p>
								<p class="err_response">
									Error Message: ${String(error)}
								</p>`,
			resultId
		);
	}
}
window.addEventListener("load", function() {
	document
		.getElementById("calculate-button")
		.addEventListener("click", function() {
			GPACalculator.populateGPA("transcript-data", "result");
		});
	document
		.getElementById("transcript-data")
		.addEventListener("change", function(e) {
			var fileInput = e.target.files[0];
			e.target.blur();
			document.getElementById("info").className = "chosen";
			document.getElementById("info").innerHTML = decodeURI(
				escape(fileInput.name)
			);
		});
});

/*************************************************\
========================TODO=======================

- Make Drag-n-Drop Functional
- Complete Parser (actually parse the whole thing)

\*************************************************/