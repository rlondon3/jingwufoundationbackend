const fs = require('fs').promises;
const path = require('path');

class ManualContentProcessor {
	constructor(manualPath = path.join(__dirname, '../assets/jwmBook')) {
		this.manualPath = path.resolve(manualPath);
		this.contentCache = null;
		this.pdf = require('pdf-parse');
	}

	async loadManualContent() {
		if (this.contentCache) return this.contentCache;

		try {
			const dataBuffer = await fs.readFile(
				path.join(this.manualPath, 'NEIGONG_MANUAL_I.pdf')
			);
			const data = await this.pdf(dataBuffer);
			this.contentCache = this.processManualContent(data.text);
			return this.contentCache;
		} catch (error) {
			console.error('Error loading manual content:', error);
			throw error;
		}
	}

	processManualContent(content) {
		// Split content into sections based on your manual's structure
		const sections = {
			'Introduction: Understanding Neigong and Poles': '',
			'Internal Body: Shape Requirements': '',
			'Solo Practice: Seated Meditation': '',
			'Partnered Practice: Seated Meditation': '',
			Conclusion: '',
		};

		let currentSection = null;
		const lines = content.split('\n');

		for (const line of lines) {
			// Check if line matches a section header
			const matchedSection = Object.keys(sections).find((header) =>
				line.trim().includes(header)
			);

			if (matchedSection) {
				currentSection = matchedSection;
				continue;
			}

			if (currentSection) {
				sections[currentSection] += line + '\n';
			}
		}

		return sections;
	}

	async searchContent(query, terms) {
		const content = await this.loadManualContent();
		const results = {};

		for (const [section, text] of Object.entries(content)) {
			const relevance = this.calculateRelevance(text, query, terms);
			if (relevance.score > 0) {
				results[section] = {
					content: text,
					relevance: relevance.score,
					excerpts: relevance.excerpts,
				};
			}
		}

		return results;
	}

	calculateRelevance(content, query, terms) {
		let score = 0;
		const excerpts = new Set();

		// Check for term matches first (higher priority)
		terms.forEach((term) => {
			const regex = new RegExp(
				`[^.!?]*\\b${term.standard}\\b[^.!?]*[.!?]`,
				'gi'
			);
			const matches = content.match(regex) || [];
			score += matches.length * 2; // Weight term matches higher
			matches.slice(0, 2).forEach((match) => excerpts.add(match.trim()));
		});

		// Check for query word matches
		const words = query.toLowerCase().split(/\s+/);
		words.forEach((word) => {
			const regex = new RegExp(`[^.!?]*\\b${word}\\b[^.!?]*[.!?]`, 'gi');
			const matches = content.match(regex) || [];
			score += matches.length;
			matches.slice(0, 1).forEach((match) => excerpts.add(match.trim()));
		});

		return {
			score,
			excerpts: Array.from(excerpts),
		};
	}
}

module.exports = ManualContentProcessor;
