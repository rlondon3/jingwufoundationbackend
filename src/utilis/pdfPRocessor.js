// utils/pdf-processor.js
const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse');

class PDFProcessor {
	constructor(resourcePath = path.join(__dirname, '../assets/resources')) {
		this.resourcePath = path.resolve(resourcePath);
		this.pdfCache = new Map(); // Full content cache
		this.metadataCache = new Map(); // Metadata cache
		this.indexCache = new Map(); // Search index cache
		this.lastIndexUpdate = null;
		this.indexUpdateInterval = 30 * 60 * 1000; // 30 minutes
	}

	async loadPDFs() {
		try {
			const files = await fs.readdir(this.resourcePath);
			const pdfFiles = files.filter((file) =>
				file.toLowerCase().endsWith('.pdf')
			);
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

	async buildSearchIndex() {
		try {
			const files = await this.loadPDFs();
			const index = new Map();

			for (const file of files) {
				console.log(`Indexing ${file}...`);
				const content = await this.getFileContent(file);
				
				// Create searchable index with both English and Chinese support
				const searchableContent = this.createSearchableContent(content, file);
				index.set(file, searchableContent);
			}

			this.indexCache = index;
			this.lastIndexUpdate = Date.now();
			console.log(`Search index built for ${files.length} PDFs`);
			
			return index;
		} catch (error) {
			console.error('Error building search index:', error);
			throw error;
		}
	}

	createSearchableContent(content, filename) {
		const sections = this.intelligentSectionSplit(content);
		
		return {
			filename,
			fullText: content,
			sections: sections,
			searchTerms: this.extractSearchTerms(content),
			language: this.detectLanguage(content),
			topics: this.extractTopics(content),
			keyPhrases: this.extractKeyPhrases(content)
		};
	}

	intelligentSectionSplit(content) {
		const sections = [];
		const paragraphs = content.split(/\n\s*\n/);
		let currentSection = '';
		let sectionTitle = 'Introduction';

		for (const paragraph of paragraphs) {
			const trimmed = paragraph.trim();
			if (!trimmed) continue;

			// Check if this looks like a section header
			if (this.looksLikeHeading(trimmed)) {
				// Save previous section
				if (currentSection) {
					sections.push({
						title: sectionTitle,
						content: currentSection.trim(),
						wordCount: currentSection.split(/\s+/).length
					});
				}
				// Start new section
				sectionTitle = trimmed;
				currentSection = '';
			} else {
				currentSection += paragraph + '\n\n';
			}
		}

		// Don't forget the last section
		if (currentSection) {
			sections.push({
				title: sectionTitle,
				content: currentSection.trim(),
				wordCount: currentSection.split(/\s+/).length
			});
		}

		return sections;
	}

	detectLanguage(content) {
		// Enhanced language detection with better thresholds
		const chineseChars = content.match(/[\u4e00-\u9fff]/g) || [];
		const englishWords = content.match(/\b[a-zA-Z]+\b/g) || [];
		const totalContentLength = content.replace(/\s+/g, '').length;
		
		const chineseRatio = chineseChars.length / totalContentLength;
		const englishRatio = englishWords.join('').length / totalContentLength;
		
		// More sophisticated detection
		if (chineseRatio > 0.4) return 'chinese';
		if (englishRatio > 0.6) return 'english';
		if (chineseRatio > 0.1 && englishRatio > 0.2) return 'mixed';
		if (chineseRatio > 0.05) return 'mixed'; // Even small amounts of Chinese indicate mixed content
		
		return 'english';
	}

	extractSearchTerms(content) {
		const terms = new Set();
		
		// English martial arts terms (expanded)
		const englishTerms = [
			'qi', 'chi', 'jin', 'li', 'neigong', 'qigong', 
			'taiji', 'tai chi', 'xingyi', 'bagua', 'hsing-i', 'pa kua',
			'meditation', 'breathing', 'energy', 'internal', 'external',
			'stance', 'posture', 'movement', 'technique', 'form',
			'practice', 'cultivation', 'training', 'exercise',
			'martial', 'arts', 'kung fu', 'gongfu', 'wushu',
			'master', 'sifu', 'teacher', 'student', 'disciple',
			'dantian', 'meridians', 'channels', 'acupoints',
			'yin', 'yang', 'balance', 'harmony', 'spirit',
			'mind', 'body', 'soul', 'consciousness', 'awareness',
			'flow', 'circulation', 'pressure', 'tension', 'relaxation',
			'strength', 'power', 'force', 'skill', 'ability'
		];

		// Chinese characters for martial arts terms (expanded)
		const chineseTerms = [
			// Energy concepts
			'气', '劲', '力', '内功', '气功', '精', '神', '意',
			// Martial arts styles
			'太极', '太极拳', '形意', '形意拳', '八卦', '八卦掌',
			'少林', '武当', '峨眉', '崆峒', '昆仑',
			// Practice concepts
			'静坐', '呼吸', '调息', '导引', '吐纳',
			'站桩', '走桩', '坐功', '卧功',
			'姿势', '动作', '技术', '招式', '套路',
			'练习', '修炼', '训练', '习练', '功夫',
			// Body parts and concepts
			'丹田', '经络', '穴位', '筋骨', '血脉',
			'心', '肝', '脾', '肺', '肾',
			// Philosophy
			'阴', '阳', '五行', '八卦', '太极',
			'道', '德', '仁', '义', '礼',
			'天', '地', '人', '自然', '宇宙',
			// Actions and states
			'松', '紧', '虚', '实', '刚', '柔',
			'进', '退', '左', '右', '上', '下',
			'开', '合', '起', '落', '转', '换'
		];

		// Compound Chinese terms (2-4 characters)
		const chineseCompoundTerms = [
			'内家拳', '外家拳', '南拳', '北腿',
			'长拳', '短打', '软功', '硬功',
			'轻功', '铁布衫', '金钟罩', '易筋经',
			'洗髓经', '九阳神功', '九阴真经',
			'混元桩', '无极桩', '三体式', '抱元桩',
			'龙虎功', '童子功', '铁砂掌', '鹰爪功'
		];

		// Extract English terms with word boundaries
		englishTerms.forEach(term => {
			const regex = new RegExp(`\\b${this.escapeRegex(term)}\\b`, 'gi');
			if (content.match(regex)) {
				terms.add(term.toLowerCase());
			}
		});

		// Extract single Chinese characters
		chineseTerms.forEach(term => {
			if (content.includes(term)) {
				terms.add(term);
			}
		});

		// Extract compound Chinese terms
		chineseCompoundTerms.forEach(term => {
			if (content.includes(term)) {
				terms.add(term);
			}
		});

		// Extract additional Chinese martial arts terms using regex patterns
		const chinesePatterns = [
			/[一二三四五六七八九十百千万]+[式招法步掌拳腿功]/g,  // Numbered techniques
			/[东南西北中]+[派门宗家]/g,  // Directional schools
			/[金木水火土]+[功法门派]/g,  // Five elements related
			/[龙虎豹蛇鹤]+[拳掌爪功]/g   // Animal styles
		];

		chinesePatterns.forEach(pattern => {
			const matches = content.match(pattern) || [];
			matches.forEach(match => terms.add(match));
		});

		return Array.from(terms);
	}

	extractTopics(content) {
		const topics = new Set();
		
		// English topic patterns for martial arts
		const englishTopicPatterns = {
			'internal_energy': /internal\s+(energy|power|force|cultivation)/gi,
			'breathing_method': /(breathing|breath|respiratory)\s+(method|technique|practice)/gi,
			'meditation_practice': /(meditation|sitting|mindfulness)\s+(practice|method|technique)/gi,
			'body_mechanics': /(posture|stance|alignment|structure)/gi,
			'martial_application': /(application|usage|technique|method)/gi,
			'energy_circulation': /(energy|qi|chi)\s+(circulation|flow|movement)/gi,
			'mind_body_unity': /(mind|consciousness)\s+(body|physical|unity)/gi,
			'traditional_training': /(traditional|classical|ancient)\s+(training|method|practice)/gi,
			'martial_philosophy': /(philosophy|principle|theory)\s+(martial|arts|fighting)/gi,
			'health_cultivation': /(health|wellness|longevity)\s+(cultivation|practice|method)/gi
		};

		// Chinese topic patterns 
		const chineseTopicPatterns = {
			'qi_cultivation': /(气|氣)\s*(功|修|练|炼)/g,
			'internal_strength': /(内|內)\s*(功|力|劲|勁)/g,
			'meditation_sitting': /(静|靜)\s*(坐|修|功)/g,
			'stance_training': /(站|桩|樁)\s*(功|法|训|練)/g,
			'breathing_regulation': /(呼吸|调息|調息)\s*(法|功|术|術)/g,
			'martial_technique': /(武|功夫|拳)\s*(法|术|術|技)/g,
			'body_method': /(身|体|體)\s*(法|功|训|練)/g,
			'mind_intention': /(意|心)\s*(念|识|識|法)/g,
			'energy_channels': /(经络|經絡|气脉|氣脈)/g,
			'traditional_method': /(传统|傳統|古法|秘传|秘傳)/g
		};

		// Extract English topics
		Object.entries(englishTopicPatterns).forEach(([topic, pattern]) => {
			if (content.match(pattern)) {
				topics.add(topic);
			}
		});

		// Extract Chinese topics
		Object.entries(chineseTopicPatterns).forEach(([topic, pattern]) => {
			if (content.match(pattern)) {
				topics.add(topic);
			}
		});

		// Extract high-level topics based on keyword density
		const martialArtsKeywords = {
			'taiji_practice': ['tai chi', 'taiji', '太极', '太極'],
			'xingyi_practice': ['xingyi', 'hsing-i', '形意'],
			'bagua_practice': ['bagua', 'pa kua', '八卦'],
			'neigong_training': ['neigong', 'nei gong', '内功', '內功'],
			'qigong_cultivation': ['qigong', 'chi kung', '气功', '氣功'],
			'dantian_development': ['dantian', 'dan tian', '丹田'],
			'meridian_theory': ['meridian', 'channel', '经络', '經絡'],
			'yin_yang_balance': ['yin yang', 'yin-yang', '阴阳', '陰陽']
		};

		Object.entries(martialArtsKeywords).forEach(([topic, keywords]) => {
			let keywordCount = 0;
			keywords.forEach(keyword => {
				const regex = new RegExp(this.escapeRegex(keyword), 'gi');
				const matches = content.match(regex) || [];
				keywordCount += matches.length;
			});
			
			// If keyword appears multiple times, consider it a topic
			if (keywordCount >= 2) {
				topics.add(topic);
			}
		});

		return Array.from(topics);
	}

	extractKeyPhrases(content) {
		const phrases = new Set();
		
		// English key terms for phrase extraction
		const englishKeyTerms = [
			'qi', 'chi', 'jin', 'li', 'neigong', 'qigong', 'taiji', 'xingyi', 'bagua',
			'energy', 'breathing', 'meditation', 'internal', 'external',
			'stance', 'posture', 'movement', 'technique', 'practice',
			'cultivation', 'training', 'power', 'force', 'strength'
		];

		// Chinese key terms for phrase extraction
		const chineseKeyTerms = [
			'气', '劲', '力', '内功', '气功', '太极', '形意', '八卦',
			'呼吸', '静坐', '修炼', '练习', '功夫', '武术',
			'丹田', '经络', '穴位', '阴阳', '五行'
		];
		
		// Extract English phrases (3-6 words)
		englishKeyTerms.forEach(term => {
			const regex = new RegExp(`(\\w+\\s+){0,2}\\b${this.escapeRegex(term)}\\b(\\s+\\w+){0,2}`, 'gi');
			const matches = content.match(regex) || [];
			matches.forEach(match => {
				const cleaned = match.trim().toLowerCase();
				if (cleaned.length > 5 && cleaned.split(' ').length <= 6) {
					phrases.add(cleaned);
				}
			});
		});

		// Extract Chinese phrases (2-8 characters around key terms)
		chineseKeyTerms.forEach(term => {
			const regex = new RegExp(`[\\u4e00-\\u9fff]{0,3}${this.escapeRegex(term)}[\\u4e00-\\u9fff]{0,3}`, 'g');
			const matches = content.match(regex) || [];
			matches.forEach(match => {
				const cleaned = match.trim();
				if (cleaned.length >= 2 && cleaned.length <= 8 && cleaned !== term) {
					phrases.add(cleaned);
				}
			});
		});

		// Extract common martial arts sentence patterns
		const chinesePhrasePatterns = [
			/[练修炼习][习练][\\u4e00-\\u9fff]{1,3}[功法术]/g,  // Practice patterns
			/[气劲力][在从通过][\\u4e00-\\u9fff]{1,3}[流动运行]/g,  // Energy flow patterns
			/[身体心意][与和及][\\u4e00-\\u9fff]{1,3}[合一统一]/g,  // Unity patterns
			/[内外上下左右][\\u4e00-\\u9fff]{1,2}[配合结合]/g  // Directional combinations
		];

		chinesePhrasePatterns.forEach(pattern => {
			const matches = content.match(pattern) || [];
			matches.forEach(match => {
				if (match.length >= 3 && match.length <= 10) {
					phrases.add(match);
				}
			});
		});

		// Extract technical English phrases
		const technicalPatterns = [
			/\b(internal|external)\s+(energy|power|strength|cultivation)\b/gi,
			/\b(breathing|meditation)\s+(technique|method|practice)\b/gi,
			/\b(martial|fighting)\s+(art|technique|application|method)\b/gi,
			/\b(mind|body|spirit)\s+(coordination|unity|integration)\b/gi,
			/\b(energy|qi|chi)\s+(circulation|flow|cultivation|development)\b/gi
		];

		technicalPatterns.forEach(pattern => {
			const matches = content.match(pattern) || [];
			matches.forEach(match => {
				phrases.add(match.toLowerCase().trim());
			});
		});

		return Array.from(phrases).slice(0, 30); // Limit to top 30 phrases
	}

	calculateAdvancedRelevance(searchableContent, query, queryTerms) {
		let score = 0;
		const excerpts = new Set();
		const { fullText, sections, searchTerms, language, topics, keyPhrases } = searchableContent;

		// 1. Direct term matching (highest weight)
		for (const term of queryTerms) {
			const termRegex = new RegExp(`\\b${this.escapeRegex(term)}\\b`, 'gi');
			const matches = fullText.match(termRegex) || [];
			score += matches.length * 3; // High weight for direct matches

			// Extract context around matches
			const contextRegex = new RegExp(`[^.!?]{0,50}\\b${this.escapeRegex(term)}\\b[^.!?]{0,50}[.!?]?`, 'gi');
			const contextMatches = fullText.match(contextRegex) || [];
			contextMatches.slice(0, 2).forEach(match => excerpts.add(match.trim()));
		}

		// 2. Search terms matching (martial arts specific terms)
		for (const searchTerm of searchTerms) {
			for (const queryTerm of queryTerms) {
				if (searchTerm.toLowerCase().includes(queryTerm.toLowerCase()) || 
					queryTerm.toLowerCase().includes(searchTerm.toLowerCase())) {
					score += 2;
					
					// Find sentences containing this term
					const termRegex = new RegExp(`[^.!?]*${this.escapeRegex(searchTerm)}[^.!?]*[.!?]`, 'gi');
					const termMatches = fullText.match(termRegex) || [];
					termMatches.slice(0, 1).forEach(match => excerpts.add(match.trim()));
				}
			}
		}

		// 3. Topic relevance
		for (const topic of topics) {
			for (const queryTerm of queryTerms) {
				if (topic.toLowerCase().includes(queryTerm.toLowerCase())) {
					score += 1.5;
				}
			}
		}

		// 4. Key phrase matching
		for (const phrase of keyPhrases) {
			for (const queryTerm of queryTerms) {
				if (phrase.includes(queryTerm.toLowerCase())) {
					score += 1;
					excerpts.add(phrase);
				}
			}
		}

		// 5. Section-based matching (structured content gets bonus)
		for (const section of sections) {
			const sectionText = section.content.toLowerCase();
			const sectionTitle = section.title.toLowerCase();
			
			for (const queryTerm of queryTerms) {
				// Title matches get higher weight
				if (sectionTitle.includes(queryTerm)) {
					score += 2;
				}
				
				// Content matches
				const sectionMatches = (sectionText.match(new RegExp(`\\b${this.escapeRegex(queryTerm)}\\b`, 'g')) || []).length;
				if (sectionMatches > 0) {
					score += sectionMatches * 0.5;
					
					// Extract relevant sentences from this section
					const sentenceRegex = new RegExp(`[^.!?]*\\b${this.escapeRegex(queryTerm)}\\b[^.!?]*[.!?]`, 'gi');
					const sentences = section.content.match(sentenceRegex) || [];
					sentences.slice(0, 1).forEach(sentence => excerpts.add(sentence.trim()));
				}
			}
		}

		// 6. Language bonus - prefer content that matches query language
		const queryLanguage = this.detectLanguage(query);
		if (queryLanguage === language || language === 'mixed') {
			score *= 1.2; // 20% bonus for language match
		}

		// 7. Multi-term query bonus
		if (queryTerms.length > 1) {
			const queryPhrase = query.toLowerCase();
			if (fullText.toLowerCase().includes(queryPhrase)) {
				score += queryTerms.length * 2; // Bonus for phrase matching
				
				// Extract phrase context
				const phraseRegex = new RegExp(`[^.!?]{0,30}${this.escapeRegex(queryPhrase)}[^.!?]{0,30}[.!?]?`, 'gi');
				const phraseMatches = fullText.match(phraseRegex) || [];
				phraseMatches.slice(0, 1).forEach(match => excerpts.add(match.trim()));
			}
		}

		return {
			score: Math.round(score * 100) / 100, // Round to 2 decimal places
			excerpts: Array.from(excerpts).slice(0, 5) // Limit excerpts
		};
	}

	escapeRegex(string) {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	async searchContent(query, maxResults = 5) {
		try {
			// Check if index needs rebuilding
			if (!this.indexCache.size || 
				!this.lastIndexUpdate || 
				Date.now() - this.lastIndexUpdate > this.indexUpdateInterval) {
				await this.buildSearchIndex();
			}

			const results = [];
			const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1);

			for (const [filename, searchableContent] of this.indexCache.entries()) {
				const relevance = this.calculateAdvancedRelevance(searchableContent, query, queryTerms);

				if (relevance.score > 0) {
					results.push({
						file: filename,
						metadata: await this.extractMetadata(filename),
						relevance: relevance.score,
						excerpts: relevance.excerpts,
						language: searchableContent.language,
						topics: searchableContent.topics
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
