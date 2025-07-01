// utils/term-normalizer.js
class JingwuTermNormalizer {
	constructor() {
		// Core Jingwu Method concepts and their relationships
		this.jingwuTerms = {
			// Force/Power concepts (Part 1)
			neigong: {
				chinese: '内功',
				pinyin: 'nei gong',
				variants: ['internal skill', 'internal practice'],
				definition:
					'Internal skill acquired through systematic practice of principles',
				section: 'Introduction: Understanding Neigong and Poles',
			},
			poles: {
				chinese: '极',
				pinyin: 'ji',
				variants: ['extremes', 'ji'],
				definition:
					'Core concept of opposites existing in relationship to each other',
				section: 'Introduction: Understanding Neigong and Poles',
			},
			jin: {
				chinese: '劲',
				pinyin: 'jin',
				variants: ['jing', 'energy', 'force'],
				definition: 'Energy/force as an independent entity',
				section: 'Introduction: Understanding Neigong and Poles',
			},
			qi: {
				chinese: '气',
				pinyin: 'qi',
				variants: ['chi'],
				definition:
					'Vital energy that harmonizes physical movement void of tension',
				section: 'Introduction: Understanding Neigong and Poles',
			},
			// Force Methods
			'total body power': {
				chinese: '整体里',
				pinyin: 'zheng ti li',
				variants: ['total force', 'complete body power'],
				definition:
					'Complete embodiment of chosen force method throughout body',
				section: 'Internal Body: Shape Requirements',
			},
			'leveraging force': {
				chinese: '倚力',
				pinyin: 'yili',
				variants: ['leaning force'],
				definition: 'Force generated through structural alignment',
				section: 'Internal Body: Shape Requirements',
			},
			'static load': {
				chinese: null,
				variants: ['static force'],
				definition:
					'Condition where force is successfully redirected groundward',
				section: 'Partnered Practice: Seated Meditation',
			},
			// Shape and Body Requirements
			shapes: {
				chinese: '形',
				pinyin: 'xing',
				variants: ['form'],
				definition: 'Physical forms that presuppose total body power',
				section: 'Internal Body: Shape Requirements',
			},
			'separating partiality': {
				chinese: '分虚实',
				pinyin: 'fen xu shi',
				variants: ['separating empty and full'],
				definition:
					'Fundamental requirement of separating empty from full states',
				section: 'Internal Body: Shape Requirements',
			},
			'heavy shoulders': {
				chinese: '沉肩',
				pinyin: 'chen jian',
				variants: ['sink shoulders'],
				relatedTerms: ['push elbows'],
				definition: 'Quality of shoulders when according to power',
				section: 'Solo Practice: Seated Meditation',
			},
			'push elbows': {
				chinese: '推肘',
				pinyin: 'tui zhou',
				variants: ['extend elbows'],
				relatedTerms: ['heavy shoulders'],
				definition: 'Advanced skill of returning force from the ground',
				section: 'Solo Practice: Seated Meditation',
			},
			'relax hips': {
				chinese: '松垮',
				pinyin: 'song kua',
				variants: ['loose hips', 'sung kua'],
				definition: 'Directive to prevent hips from remaining lifted',
				section: 'Solo Practice: Seated Meditation',
			},
			// States and Qualities
			empty: {
				chinese: '虚',
				pinyin: 'xu',
				variants: ['void', 'insubstantial'],
				definition: 'State of being void of force/power',
				section: 'Internal Body: Shape Requirements',
			},
			full: {
				chinese: '实',
				pinyin: 'shi',
				variants: ['substantial', 'solid'],
				definition: 'State of containing force/power',
				section: 'Internal Body: Shape Requirements',
			},
			relaxed: {
				chinese: '松',
				pinyin: 'song',
				variants: ['sung', 'loose'],
				definition:
					'Quality achieved when force is properly directed to ground',
				section: 'Solo Practice: Seated Meditation',
			},
		};

		// Future content markers
		this.futureContent = {
			'issuing jin': {
				volume: 'Neigong II: Internal Power Development',
				description: 'Study of issuing internal power',
			},
			'neutralizing jin': {
				volume: 'Neigong III: Internal Power Development 2',
				description: 'Study of neutralizing incoming force',
			},
			'yielding jin': {
				volume: 'Neigong III: Internal Power Development 2',
				description: 'Study of yielding to incoming force',
			},
			'internal striking': {
				volume: 'Neigong IV: Weaponizing Internal Power',
				description: 'Basic strategies for weaponizing neigong',
			},
			'intention development': {
				volume: 'Neigong V: The Intent',
				description: 'Development of intention over physical body',
			},
		};

		this.buildReverseLookup();
	}

	buildReverseLookup() {
		this.reverseTerms = new Map();

		for (const [standard, info] of Object.entries(this.jingwuTerms)) {
			// Add standard term
			this.reverseTerms.set(standard.toLowerCase(), {
				standard,
				info,
			});

			// Add Chinese if exists
			if (info.chinese) {
				this.reverseTerms.set(info.chinese, {
					standard,
					info,
				});
			}

			// Add pinyin if exists
			if (info.pinyin) {
				this.reverseTerms.set(info.pinyin, {
					standard,
					info,
				});
			}

			// Add variants
			if (info.variants) {
				info.variants.forEach((variant) => {
					this.reverseTerms.set(variant.toLowerCase(), {
						standard,
						info,
					});
				});
			}
		}
	}

	findJingwuTerms(query) {
		const terms = [];
		const queryWords = query.toLowerCase().replace(/[?.,]/g, '').split(/\s+/);

		// First, try multi-word matches
		for (let i = 0; i < queryWords.length; i++) {
			for (let j = i + 1; j <= queryWords.length; j++) {
				const phrase = queryWords.slice(i, j).join(' ');
				if (this.reverseTerms.has(phrase)) {
					terms.push(this.reverseTerms.get(phrase));
				}
			}
		}

		// If no multi-word terms, check single words with some flexibility
		if (terms.length === 0) {
			queryWords.forEach((word) => {
				// Look for variants and stems
				const potentialMatches = [
					word,
					word.replace(/s$/, ''), // remove plural
					word.replace(/ing$/, ''), // remove -ing form
				];

				potentialMatches.forEach((match) => {
					if (this.reverseTerms.has(match)) {
						terms.push(this.reverseTerms.get(match));
					}
				});
			});
		}

		// Special handling for conceptual keywords
		const conceptualKeywords = {
			external: ['jin', 'total body power'],
			power: ['jin', 'total body power'],
			force: ['jin', 'total body power', 'leveraging force'],
		};

		queryWords.forEach((word) => {
			if (conceptualKeywords[word]) {
				conceptualKeywords[word].forEach((termKey) => {
					const term = this.reverseTerms.get(termKey);
					if (term && !terms.some((t) => t.standard === term.standard)) {
						terms.push(term);
					}
				});
			}
		});

		// Remove duplicates
		return Array.from(new Set(terms));
	}

	isFutureTopic(query) {
		const queryLower = query.toLowerCase();
		return Object.entries(this.futureContent).find(([term, info]) =>
			queryLower.includes(term.toLowerCase())
		);
	}
}

module.exports = JingwuTermNormalizer;
