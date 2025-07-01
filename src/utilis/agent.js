// utils/neigong-agent.js
require('dotenv').config();
const { ChatAnthropic } = require('@langchain/anthropic');
const { HumanMessage } = require('@langchain/core/messages');
const { getJson } = require('serpapi');
const PDFProcessor = require('./pdfPRocessor');
const TermNormalizer = require('./termNormalizer');
const ManualContentProcessor = require('./manualProcessor');

class NeigongManualAgent {
	constructor() {
		this.validateEnvironmentVars();
		this.initializeModels();
		this.searchCache = new Map();
		this.pdfProcessor = new PDFProcessor();
		this.manualProcessor = new ManualContentProcessor();
		this.termNormalizer = new TermNormalizer();
	}

	validateEnvironmentVars() {
		const requiredVars = ['ANTHROPIC_API_KEY'];
		// SERP_API_KEY is optional - we can work without web search
		const missingVars = requiredVars.filter((varName) => !process.env[varName]);
		if (missingVars.length > 0) {
			throw new Error(
				`Missing required environment variables: ${missingVars.join(', ')}`
			);
		}
	}

	initializeModels() {
		try {
			this.anthropicModel = new ChatAnthropic({
				apiKey: process.env.ANTHROPIC_API_KEY,
				modelName: 'claude-3-5-sonnet-20241022',
				temperature: 0.7,
				timeout: 60000,
				maxRetries: 2,
			});
		} catch (error) {
			throw new Error(`Failed to initialize AI models: ${error.message}`);
		}
	}

	async handleQuery(query) {
		try {
			console.log('Processing AI Sifu query:', query);

			// Find relevant Jingwu terms
			let terms = [];
			try {
				terms = this.termNormalizer.findJingwuTerms(query);
				console.log('Found Jingwu terms:', terms);
			} catch (termError) {
				console.error('Error in findJingwuTerms:', termError);
			}

			// Check for future topics first
			let futureTopic = null;
			try {
				futureTopic = this.termNormalizer.isFutureTopic(query);
				console.log('Future topic check:', futureTopic);
			} catch (futureTopicError) {
				console.error('Error in isFutureTopic:', futureTopicError);
			}

			if (futureTopic) {
				return this.generateFutureTopicResponse(futureTopic);
			}

			// Search manual content first (primary source)
			const manualContent = await this.manualProcessor.searchContent(
				query,
				terms
			);

			// Optionally fetch PDF content for supporting context
			let classicalContent = null;
			try {
				classicalContent = await this.pdfProcessor.searchContent(query);
			} catch (pdfError) {
				console.log('PDF content not available, proceeding with manual only');
				classicalContent = null;
			}

			return this.generateResponse({
				query,
				terms,
				manualContent,
				classicalContent,
			});
		} catch (error) {
			console.error('Error handling AI Sifu query:', error);
			throw error;
		}
	}

	async generateResponse({ query, terms, manualContent, classicalContent }) {
		try {
			// If NO manual content is found, create a clear message
			if (Object.keys(manualContent).length === 0) {
				return {
					response: `The Jingwu Method does not directly address this query. No relevant content was found in the primary source. You may want to rephrase your question or ask about fundamental concepts like neigong, poles, jin, or qi.`,
					terms_used: [],
					manual_sections: [],
					classical_references: [],
				};
			}

			const prompt = `
                CRITICAL METHODOLOGY FOR AI SIFU RESPONSE:
                1. You are the AI Sifu for the Jingwu Method martial arts platform
                2. MANUAL CONTENT IS THE PRIMARY AND AUTHORITATIVE SOURCE
                3. Classical texts can ONLY be used to:
                   a) Provide historical context
                   b) Validate manual principles
                   c) Offer supplementary understanding WITHOUT contradicting manual content
                4. STRICT HIERARCHY OF INTERPRETATION:
                   - Manual content takes absolute precedence
                   - Classical texts are secondary and supplementary
                   - NO introduction of concepts not present in manual
                5. DO NOT INVALIDATE THE CLASSICS OR THE MANUAL
                   - Always focus on the similarities and connections
                   - Never directly state one source is superior to another
    
                Student Query: "${query}"
    
                MANUAL CONTENT (PRIMARY SOURCE): 
                ${JSON.stringify(manualContent)}
    
                CLASSICAL CONTEXT (FOR POTENTIAL SUPPLEMENTARY VALIDATION): 
                ${
									classicalContent
										? JSON.stringify(classicalContent)
										: 'No additional classical context available'
								}
    
                VALIDATION PROCESS:
                - Identify key principles in manual content
                - Carefully cross-reference with classical texts if available
                - Highlight alignments ONLY if they directly support manual principles
                - CRITICAL: cite classical text directly: do not mix manual content
                - ZERO tolerance for introducing new interpretations to the manual
    
                Terms Referenced: ${JSON.stringify(terms)}

                RESPONSE GUIDELINES:
                1. Speak as a knowledgeable Sifu guiding a student
                2. Address the specific student concern directly
                3. MINIMAL external interpretation
                4. Focus on practical guidance from manual
                5. Use encouraging, instructional tone
                6. Reference specific manual sections when possible
    
                RESPONSE STRUCTURE:
                1. Direct answer to the student's question
                2. Present manual's core content on this topic
                3. Provide practical guidance for implementation
                4. If available, add classical validation that supports the manual's approach

                KEY CONSIDERATIONS:
                - Directly answer the student's specific question
                - Use manual's precise terminology
                - Provide practical insight for their practice
                - Be encouraging and supportive as a Sifu would be
            `;

			const response = await this.anthropicModel.invoke([
				new HumanMessage(prompt),
			]);

			return this.processResponse(response, terms, manualContent);
		} catch (error) {
			console.error('Error generating AI Sifu response:', error);
			throw error;
		}
	}

	processResponse(response, originalTerms, manualContent) {
		try {
			const processed = {
				response: response.content,
				terms_used: [],
				manual_sections: [],
				classical_references: [],
			};

			// Extract terms used from the original terms found
			originalTerms.forEach((termData) => {
				if (
					response.content
						.toLowerCase()
						.includes(termData.standard.toLowerCase())
				) {
					processed.terms_used.push({
						term: termData.standard,
						definition: termData.info.definition,
						section: termData.info.section,
					});
				}
			});

			// Extract manual sections referenced
			Object.keys(manualContent).forEach((section) => {
				if (
					response.content.includes(section) ||
					manualContent[section].relevance > 0
				) {
					processed.manual_sections.push(section);
				}
			});

			// Extract classical references if applicable
			const classicalPattern =
				/classical\s+(?:sources?|texts?)\s+(?:suggest|indicate|show)[^:]*:\s*([^.]+)/gi;
			let match;
			while ((match = classicalPattern.exec(response.content)) !== null) {
				processed.classical_references.push(match[1].trim());
			}

			return processed;
		} catch (error) {
			console.error('Error processing AI Sifu response:', error);
			return {
				response: response.content,
				terms_used: [],
				manual_sections: [],
				classical_references: [],
			};
		}
	}

	generateFutureTopicResponse(futureTopic) {
		const [term, info] = futureTopic;
		return {
			response: `The topic of ${term} will be covered in detail in ${info.volume}. ${info.description}. The current manual focuses on the fundamental transformation required before this advanced study can begin. Please focus on mastering the basic principles of neigong, understanding poles, and developing proper internal body requirements first.`,
			terms_used: [
				{
					term: term,
					definition: `Future content: ${info.description}`,
					section: info.volume,
				},
			],
			manual_sections: [],
			classical_references: [],
			type: 'future_content',
		};
	}

	// Optional: Search additional info if SERP_API_KEY is available
	async searchAdditionalInfo(topic) {
		if (!process.env.SERP_API_KEY) {
			console.log('SERP_API_KEY not available, skipping web search');
			return null;
		}

		try {
			const cacheKey = topic.toLowerCase();
			if (this.searchCache.has(cacheKey)) {
				return this.searchCache.get(cacheKey);
			}

			const searchParams = {
				q: `${topic} internal martial arts neigong qigong definition technique explanation`,
				api_key: process.env.SERP_API_KEY,
				engine: 'google',
				num: 5,
			};

			const results = await new Promise((resolve, reject) => {
				getJson(searchParams, (json) => {
					if (json.error) {
						reject(new Error(json.error));
					} else {
						resolve(json);
					}
				});
			});

			this.searchCache.set(cacheKey, results);
			return results;
		} catch (error) {
			console.error(`Search failed for ${topic}:`, error);
			return null;
		}
	}

	// Estimate API cost (for tracking purposes)
	estimateResponseCost(query, response) {
		// Rough estimation based on token count
		// Claude 3 Sonnet is approximately $3 per 1M input tokens, $15 per 1M output tokens
		const inputTokens = Math.ceil(query.length / 4); // Rough estimate: 4 chars per token
		const outputTokens = Math.ceil((response?.response?.length || 0) / 4);

		const inputCostCents = (inputTokens / 1000000) * 300; // $3 per 1M tokens = 300 cents
		const outputCostCents = (outputTokens / 1000000) * 1500; // $15 per 1M tokens = 1500 cents

		return Math.max(1, Math.round(inputCostCents + outputCostCents)); // Minimum 1 cent
	}
}

module.exports = {
	NeigongManualAgent,
};
