// utils/neigong-agent.js
require('dotenv').config();
const { ChatAnthropic } = require('@langchain/anthropic');
const { HumanMessage } = require('@langchain/core/messages');
const { getJson } = require('serpapi');
const PDFProcessor = require('./pdfPRocessor');
const TermNormalizer = require('./termNormalizer');
const ManualContentProcessor = require('./manualProcessor');

class NeigongManualAgent {
	constructor(pool = null) {
		this.validateEnvironmentVars();
		this.initializeModels();
		this.searchCache = new Map();
		this.pdfProcessor = new PDFProcessor();
		this.manualProcessor = new ManualContentProcessor(pool);
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

	async handleQuery(query, courseId = null) {
		try {
			// Find relevant Jingwu terms
			let terms = [];
			try {
				terms = this.termNormalizer.findJingwuTerms(query);
			} catch (termError) {
				console.error('Error in findJingwuTerms:', termError);
			}

			// Check for future topics first
			let futureTopic = null;
			try {
				futureTopic = this.termNormalizer.isFutureTopic(query);
			} catch (futureTopicError) {
				console.error('Error in isFutureTopic:', futureTopicError);
			}

			if (futureTopic) {
				return this.generateFutureTopicResponse(futureTopic);
			}

			// Search manual content first (primary source) - now course-specific
			const manualContent = await this.manualProcessor.searchContent(
				query,
				terms,
				courseId
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
			// If NO course content is found, rely on classical texts only
			if (Object.keys(manualContent).length === 0) {
				console.log('No course-specific content found, using classical texts only');
				// Don't return early - let AI use classical texts as primary source
			}

			const hasManualContent = Object.keys(manualContent).length > 0;
		
		// Categorize content types for better prompt organization
		const courseStructureContent = {};
		const resourceContent = {};
		
		Object.entries(manualContent).forEach(([section, data]) => {
			if (data.content_type === 'course_info' || data.content_type === 'module_info') {
				courseStructureContent[section] = data;
			} else {
				resourceContent[section] = data;
			}
		});

		const hasCourseStructure = Object.keys(courseStructureContent).length > 0;
		const hasResourceContent = Object.keys(resourceContent).length > 0;
			
			const prompt = `
                CRITICAL METHODOLOGY FOR AI SIFU RESPONSE:
                1. You are the AI Sifu for the Jingwu Method martial arts platform
                ${hasManualContent ? `
                2. COURSE CONTENT IS THE PRIMARY AND AUTHORITATIVE SOURCE
                3. STAY STRICTLY WITHIN THE SPECIFIC MARTIAL ART SYSTEM OF THIS COURSE
                   - DO NOT mix techniques, concepts, or training methods from other martial arts systems
                   - If the course is Xingyiquan, only give Xingyiquan guidance
                   - If the course is Taijiquan, only give Taijiquan guidance  
                   - If the course is Baguazhang, only give Baguazhang guidance
                4. Classical texts can ONLY be used to:
                   a) Provide historical context for THIS SPECIFIC SYSTEM
                   b) Validate course content principles within THIS SYSTEM
                   c) Offer supplementary understanding WITHOUT contradicting course content
                5. STRICT HIERARCHY OF INTERPRETATION:
                   - Course content takes absolute precedence
                   - Classical texts are secondary and supplementary
                   - NO introduction of concepts not present in course content
                   - NO cross-system contamination or technique mixing` : `
                2. NO COURSE-SPECIFIC CONTENT AVAILABLE - RELY ON CLASSICAL TEXTS
                3. Use classical martial arts texts as your primary knowledge source
                4. Draw from traditional martial arts principles and teachings
                5. Provide authentic martial arts guidance based on classical sources`}
                6. DO NOT INVALIDATE THE CLASSICS OR COURSE CONTENT
                   - Always focus on the similarities and connections
                   - Never directly state one source is superior to another
                7. SYSTEM PURITY ENFORCEMENT:
                   - Never recommend techniques from other martial arts systems
                   - If course content doesn't cover a topic, say so rather than filling gaps with other systems
                   - Keep all guidance within the specific martial art being studied
    
                Student Query: "${query}"
    
                ${hasCourseStructure ? `COURSE STRUCTURE (PRIMARY REFERENCE):
                This shows the complete course organization, modules, and lessons:
                ${JSON.stringify(courseStructureContent, null, 2)}` : ''}

                ${hasResourceContent ? `COURSE RESOURCES (SECONDARY REFERENCE):
                Additional course materials and detailed content:
                ${JSON.stringify(resourceContent, null, 2)}` : ''}

                ${!hasManualContent ? 'COURSE CONTENT: None available for this course' : ''}
    
                CLASSICAL TEXTS (${hasManualContent ? 'FOR SUPPLEMENTARY VALIDATION' : 'PRIMARY SOURCE'}): 
                ${
									classicalContent
										? JSON.stringify(classicalContent)
										: 'No classical text context available'
								}
    
                CONTENT AWARENESS INSTRUCTIONS:
                ${hasManualContent ? `
                - Be aware of the complete course structure, module names, and lesson titles
                - When answering questions, reference specific modules/lessons if relevant
                - Guide students to appropriate modules/lessons for deeper study
                - Understand the learning progression through the course structure
                - Connect student questions to the logical flow of the curriculum
                - If a question relates to a specific module or lesson, mention it explicitly
                - Identify key principles in course content
                - Carefully cross-reference with classical texts if available
                - Highlight alignments ONLY if they directly support course principles` : `
                - Draw from classical martial arts principles and teachings
                - Provide authentic guidance based on traditional sources
                - Use established martial arts terminology and concepts
                - Maintain respect for traditional lineages and methods`}
    
                Terms Referenced: ${JSON.stringify(terms)}

                RESPONSE GUIDELINES:
                1. Speak as a knowledgeable Sifu guiding a student through their course
                2. Address the specific student concern directly
                3. Reference relevant course modules and lessons when applicable
                4. Focus on practical guidance from ${hasManualContent ? 'course content' : 'classical sources'}
                5. Use encouraging, instructional tone
                6. Guide students to appropriate sections of their course for further study
    
                OFF-TOPIC QUERY HANDLING:
                - If the question is completely unrelated to martial arts, course content, or traditional practices (e.g., pizza, weather, politics, entertainment), respond ONLY with the redirection format below
                - For off-topic queries, find a relevant wisdom quote from the available resources or classical texts about focus, discipline, or dedication
                - Response format: "[Relevant wisdom quote from resources/classics] I am your AI Sifu, focused on guiding you through your martial arts journey. Let's keep our discussion centered on your course content and practice. What aspect of your training can I help you with?"
                - If no relevant quote is available, use: "As the masters teach, 'A focused mind accomplishes a thousand tasks, while a scattered mind completes none.' I am your AI Sifu, focused on guiding you through your martial arts journey. Let's keep our discussion centered on your course content and practice. What aspect of your training can I help you with?"
                - DO NOT explain why the response is appropriate or provide meta-commentary about your redirection approach

                COMPREHENSIVE SYNTHESIS APPROACH:
                ${hasManualContent ? `
                - SYNTHESIZE information from ALL relevant course resources and modules
                - Draw connections between different course sections when they relate to the question
                - Present a complete understanding by weaving together multiple course materials
                - Show how different parts of the course curriculum connect and support each other
                - Reference multiple modules/lessons when they collectively address the topic
                - Create comprehensive answers that demonstrate the full depth of course knowledge` : `
                - Synthesize information from all available classical sources
                - Draw connections between different traditional teachings
                - Present comprehensive understanding from multiple classical perspectives`}
    
                RESPONSE STRUCTURE:
                ${hasManualContent ? `
                1. Direct answer synthesizing ALL relevant course content
                2. Reference multiple course modules/lessons that address this topic
                3. Present integrated teachings from across the course curriculum
                4. Show connections between different course sections
                5. Provide comprehensive practical guidance drawing from all relevant materials
                6. Guide to multiple specific modules/lessons for complete understanding
                7. If available, add classical validation that supports the integrated course approach` : `
                1. Direct answer synthesizing classical martial arts teachings
                2. Present comprehensive view from multiple traditional sources
                3. Provide practical guidance based on integrated traditional methods
                4. Reference multiple classical sources when applicable`}

                KEY CONSIDERATIONS:
                - Directly answer the student's specific question
                - Be aware of the student's position in the course structure
                - Use ${hasManualContent ? "course content's precise terminology" : 'traditional martial arts terminology'}
                - Provide practical insight for their practice
                - Be encouraging and supportive as a Sifu would be
                - Guide students through their learning journey
                - NEVER mix martial arts systems - stay strictly within the course's specific art
                - If the course doesn't cover what they're asking about, acknowledge this limitation rather than borrowing from other systems
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
