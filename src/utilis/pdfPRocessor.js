// utils/pdf-processor.js
const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse');

class PDFProcessor {
	constructor(resourcePath = path.join(__dirname, '../assets/resources')) {
		this.resourcePath = path.resolve(resourcePath);
		this.pdfCache = new Map();
		this.metadataCache = new Map();
	}

	async loadPDFs() {
		try {
			const files = await fs.readdir(this.resourcePath);
			const pdfFiles = files.filter((file) =>
				file.toLowerCase().endsWith('.pdf')
			);
			console.log(`Found ${pdfFiles.length} PDF files in resources directory`);
			return pdfFiles;
		} catch (error) {
			console.error('Error loading PDFs:', error);
			throw error;
		}
	}

	async extractMetadata(filePath) {
		try {
			if (this.metadataCache.has(filePath)) {
				return this.metadataCache.get(filePath);
			}

			const dataBuffer = await fs.readFile(
				path.join(this.resourcePath, filePath)
			);
			const data = await pdf(dataBuffer);

			const metadata = {
				title: this.extractTitle(data) || filePath,
				author: this.extractAuthor(data) || 'Unknown',
				pageCount: data.numpages,
				fileSize: dataBuffer.length,
				info: data.info,
				structure: await this.extractStructure(data),
			};

			this.metadataCache.set(filePath, metadata);
			return metadata;
		} catch (error) {
			console.error(`Error extracting metadata from ${filePath}:`, error);
			throw error;
		}
	}

	extractTitle(data) {
		// Try to extract title from PDF info or first page content
		return data.info.Title || this.findTitleInContent(data.text);
	}

	extractAuthor(data) {
		// Try to extract author from PDF info or content
		return data.info.Author || this.findAuthorInContent(data.text);
	}

	async extractStructure(data) {
		// Extract table of contents or major sections
		return {
			sections: this.findSections(data.text),
			mainTopics: this.identifyMainTopics(data.text),
		};
	}

	findTitleInContent(text) {
		// Basic title extraction from first page
		const firstPageText = text.split('\n').slice(0, 5).join(' ');
		const titleMatch = firstPageText.match(/^[\s\n]*(.+?)[\n\r]/);
		return titleMatch ? titleMatch[1].trim() : null;
	}

	findAuthorInContent(text) {
		// Look for author patterns in text
		const authorPatterns = [
			/by\s+([^.\n]+)/i,
			/author[:\s]+([^.\n]+)/i,
			/written by\s+([^.\n]+)/i,
		];

		for (const pattern of authorPatterns) {
			const match = text.match(pattern);
			if (match) return match[1].trim();
		}
		return null;
	}

	findSections(text) {
		// Find major section headings
		const sections = [];
		const lines = text.split('\n');

		for (const line of lines) {
			if (this.looksLikeHeading(line)) {
				sections.push(line.trim());
			}
		}

		return sections;
	}

	looksLikeHeading(line) {
		// Heuristics for identifying section headings
		const trimmed = line.trim();
		return (
			trimmed.length > 0 &&
			trimmed.length < 100 &&
			/^[A-Z][^.!?]*$/.test(trimmed) &&
			!trimmed.includes(',')
		);
	}

	identifyMainTopics(text) {
		// Extract main topics based on frequency and context
		const topics = new Set();
		const commonTerms = [
			'neigong',
			'qigong',
			'technique',
			'practice',
			'energy',
		];

		for (const term of commonTerms) {
			const regex = new RegExp(`\\b${term}\\b[^.!?]*[.!?]`, 'gi');
			const matches = text.match(regex) || [];
			matches.forEach((match) => topics.add(match.trim()));
		}

		return Array.from(topics);
	}

	async searchContent(topic, maxResults = 5) {
		try {
			const results = [];
			const files = await this.loadPDFs();

			for (const file of files) {
				const content = await this.getFileContent(file);
				const relevance = this.calculateRelevance(content, topic);

				if (relevance.score > 0) {
					results.push({
						file,
						metadata: await this.extractMetadata(file),
						relevance: relevance.score,
						excerpts: relevance.excerpts,
					});
				}
			}

			// Sort by relevance and limit results
			return results
				.sort((a, b) => b.relevance - a.relevance)
				.slice(0, maxResults);
		} catch (error) {
			console.error('Error searching PDF content:', error);
			// Return empty results instead of throwing
			return [];
		}
	}

	async getFileContent(filePath) {
		try {
			if (this.pdfCache.has(filePath)) {
				return this.pdfCache.get(filePath);
			}

			const dataBuffer = await fs.readFile(
				path.join(this.resourcePath, filePath)
			);
			const data = await pdf(dataBuffer);

			this.pdfCache.set(filePath, data.text);
			return data.text;
		} catch (error) {
			console.error(`Error reading file ${filePath}:`, error);
			throw error;
		}
	}

	calculateRelevance(content, topic) {
		const words = topic.toLowerCase().split(/\s+/);
		const contentLower = content.toLowerCase();
		let score = 0;
		const excerpts = new Set();

		// Search for exact matches and variations
		for (const word of words) {
			const regex = new RegExp(`[^.!?]*\\b${word}\\b[^.!?]*[.!?]`, 'gi');
			const matches = content.match(regex) || [];

			score += matches.length;
			matches.slice(0, 3).forEach((match) => excerpts.add(match.trim()));
		}

		// Look for phrases containing all words
		const phraseRegex = new RegExp(
			`[^.!?]*${words.join('.*')}[^.!?]*[.!?]`,
			'gi'
		);
		const phraseMatches = content.match(phraseRegex) || [];
		score += phraseMatches.length * 2; // Weight phrase matches higher
		phraseMatches.slice(0, 2).forEach((match) => excerpts.add(match.trim()));

		return {
			score,
			excerpts: Array.from(excerpts),
		};
	}

	clearCache() {
		this.pdfCache.clear();
		this.metadataCache.clear();
	}
}

module.exports = PDFProcessor;
