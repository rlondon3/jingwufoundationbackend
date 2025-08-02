const fs = require('fs').promises;
const path = require('path');

class ManualContentProcessor {
	constructor(pool = null) {
		this.pool = pool;
		this.contentCache = new Map(); // Cache by resource ID
		this.pdf = require('pdf-parse');
	}

	async getCourseManualResources(courseId) {
		if (!this.pool) {
			throw new Error('Database pool not provided to ManualContentProcessor');
		}

		try {
			const sql = `
				SELECT r.id, r.title, r.content, r.type
				FROM resources r
				JOIN resource_courses rc ON r.id = rc.resource_id
				WHERE rc.course_id = $1 AND r.type IN ('manual', 'blog', 'article') AND r.is_published = true
				ORDER BY r.created_at ASC
			`;
			
			const result = await this.pool.query(sql, [courseId]);
			return result.rows;
		} catch (error) {
			console.error('Error fetching course content resources:', error);
			throw error;
		}
	}

	async getCourseStructure(courseId) {
		if (!this.pool) {
			throw new Error('Database pool not provided to ManualContentProcessor');
		}

		try {
			// Get course details with modules and lessons
			const courseStructureSql = `
				SELECT 
					c.id as course_id,
					c.title as course_title,
					c.description as course_description,
					c.learning_objectives,
					c.prerequisites,
					m.id as module_id,
					m.title as module_title,
					m.description as module_description,
					m.order_sequence as module_order,
					l.id as lesson_id,
					l.title as lesson_title,
					l.lesson_type,
					l.content_text as lesson_content,
					l.duration_minutes,
					l.order_sequence as lesson_order
				FROM courses c
				LEFT JOIN modules m ON c.id = m.course_id
				LEFT JOIN lessons l ON m.id = l.module_id
				WHERE c.id = $1 AND c.is_published = true
				ORDER BY m.order_sequence ASC, l.order_sequence ASC
			`;

			const result = await this.pool.query(courseStructureSql, [courseId]);
			
			if (result.rows.length === 0) {
				return null;
			}

			// Structure the data into a hierarchical format
			const courseInfo = {
				id: result.rows[0].course_id,
				title: result.rows[0].course_title,
				description: result.rows[0].course_description,
				learning_objectives: result.rows[0].learning_objectives,
				prerequisites: result.rows[0].prerequisites,
				modules: {}
			};

			// Group modules and lessons
			result.rows.forEach(row => {
				if (row.module_id) {
					if (!courseInfo.modules[row.module_id]) {
						courseInfo.modules[row.module_id] = {
							id: row.module_id,
							title: row.module_title,
							description: row.module_description,
							order: row.module_order,
							lessons: {}
						};
					}

					if (row.lesson_id) {
						courseInfo.modules[row.module_id].lessons[row.lesson_id] = {
							id: row.lesson_id,
							title: row.lesson_title,
							type: row.lesson_type,
							content: row.lesson_content,
							duration: row.duration_minutes,
							order: row.lesson_order
						};
					}
				}
			});

			return courseInfo;
		} catch (error) {
			console.error('Error fetching course structure:', error);
			throw error;
		}
	}

	async loadManualContent(courseId = null) {
		// Always try to load course-specific resources from database
		if (courseId && this.pool) {
			return await this.loadCourseManualContent(courseId);
		}

		// If no courseId provided, return empty content
		// AI will rely only on classical texts from resources folder
		return {};
	}

	async loadCourseManualContent(courseId) {
		const cacheKey = `course_${courseId}`;
		if (this.contentCache.has(cacheKey)) {
			return this.contentCache.get(cacheKey);
		}

		try {
			// Get both course resources and course structure
			const [courseResources, courseStructure] = await Promise.all([
				this.getCourseManualResources(courseId),
				this.getCourseStructure(courseId)
			]);
			
			const combinedContent = {};

			// 1. Add course structure information
			if (courseStructure) {
				// Add course overview section
				combinedContent['Course Overview'] = {
					content: `Course: ${courseStructure.title}\n\nDescription: ${courseStructure.description || 'No description available'}\n\nLearning Objectives: ${courseStructure.learning_objectives || 'Not specified'}\n\nPrerequisites: ${courseStructure.prerequisites || 'None specified'}`,
					relevance: 0,
					excerpts: [],
					type: 'course_info'
				};

				// Add module and lesson information
				Object.values(courseStructure.modules).forEach(module => {
					if (module.title) {
						// Add module information
						const moduleKey = `Module: ${module.title}`;
						let moduleContent = `Module ${module.order}: ${module.title}`;
						if (module.description) {
							moduleContent += `\n\nDescription: ${module.description}`;
						}

						// Add lesson titles and content
						const lessons = Object.values(module.lessons).sort((a, b) => a.order - b.order);
						if (lessons.length > 0) {
							moduleContent += '\n\nLessons in this module:';
							lessons.forEach(lesson => {
								moduleContent += `\n- Lesson ${lesson.order}: ${lesson.title}`;
								if (lesson.type) {
									moduleContent += ` (${lesson.type})`;
								}
								if (lesson.duration) {
									moduleContent += ` - ${lesson.duration} minutes`;
								}
								if (lesson.content && lesson.type === 'article') {
									// Include article content for text-based lessons
									moduleContent += `\n  Content: ${this.stripHtml(lesson.content)}`;
								}
							});
						}

						combinedContent[moduleKey] = {
							content: moduleContent,
							relevance: 0,
							excerpts: [],
							type: 'module_info'
						};
					}
				});
			}

			// 2. Add traditional resource content (manuals, blogs, articles)
			for (const resource of courseResources) {
				let content;
				
				if (resource.content) {
					// If content is stored directly in database (HTML/text)
					content = this.processTextContent(resource.content, resource.title);
				} else {
					console.warn(`Content resource ${resource.id} has no content field`);
					continue;
				}
				
				// Merge content by sections
				Object.keys(content).forEach(section => {
					const resourceSection = `${section} (${resource.title})`;
					combinedContent[resourceSection] = {
						content: content[section],
						relevance: 0,
						excerpts: [],
						type: 'resource_content'
					};
				});
			}

			// If no content found at all
			if (Object.keys(combinedContent).length === 0) {
				console.log(`No content resources found for course ${courseId}, AI will use only classical texts`);
				this.contentCache.set(cacheKey, {});
				return {};
			}

			this.contentCache.set(cacheKey, combinedContent);
			return combinedContent;
		} catch (error) {
			console.error(`Error loading course ${courseId} content resources:`, error);
			// Return empty content - AI will use only classical texts
			this.contentCache.set(cacheKey, {});
			return {};
		}
	}

	stripHtml(html) {
		// Simple HTML stripping - remove tags and decode entities
		return html
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}

	processTextContent(htmlContent, resourceTitle) {
		// Strip HTML tags and process as text content
		const textContent = this.stripHtml(htmlContent);
		
		// For now, treat the entire content as one section
		// In the future, we could parse HTML headers to create sections
		return {
			[resourceTitle]: textContent
		};
	}


	async searchContent(query, terms, courseId = null) {
		const content = await this.loadManualContent(courseId);
		const results = {};

		// Always include high-relevance matches
		for (const [section, contentData] of Object.entries(content)) {
			// Handle both old format (string) and new format (object with content property)
			const text = typeof contentData === 'string' ? contentData : contentData.content;
			const contentType = typeof contentData === 'object' ? contentData.type : 'legacy_content';
			
			const relevance = this.calculateRelevance(text, query, terms);
			if (relevance.score > 0) {
				results[section] = {
					content: text,
					relevance: relevance.score,
					excerpts: relevance.excerpts,
					type: 'direct_match',
					content_type: contentType
				};
			}
		}

		// Also find related/adjacent content with lower threshold
		const relatedContent = this.findRelatedContent(content, query, terms, results);
		
		// Merge related content with lower priority
		Object.keys(relatedContent).forEach(section => {
			if (!results[section]) { // Don't override direct matches
				results[section] = {
					...relatedContent[section],
					type: 'related_content'
				};
			}
		});

		return results;
	}

	findRelatedContent(content, query, terms, directMatches) {
		const related = {};
		const queryWords = query.toLowerCase().split(/\s+/);
		const directSections = Object.keys(directMatches);

		for (const [section, contentData] of Object.entries(content)) {
			if (directSections.includes(section)) continue; // Skip direct matches

			// Handle both old format (string) and new format (object with content property)
			const text = typeof contentData === 'string' ? contentData : contentData.content;
			const contentType = typeof contentData === 'object' ? contentData.type : 'legacy_content';

			// Look for conceptual relationships
			const conceptualScore = this.calculateConceptualRelevance(text, query, terms, queryWords);
			
			if (conceptualScore.score > 0.3) { // Lower threshold for related content
				related[section] = {
					content: text,
					relevance: conceptualScore.score,
					excerpts: conceptualScore.excerpts,
					relationship: conceptualScore.relationship,
					content_type: contentType
				};
			}
		}

		return related;
	}

	calculateConceptualRelevance(content, query, terms, queryWords) {
		let score = 0;
		const excerpts = new Set();
		let relationship = [];

		// Helper function to escape regex special characters
		const escapeRegex = (string) => {
			return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		};

		// Conceptual keyword mapping for martial arts
		const conceptMap = {
			// Internal energy concepts
			'energy': ['qi', 'chi', 'jin', 'internal power', 'force', 'vital energy'],
			'power': ['jin', 'li', 'force', 'strength', 'energy'],
			'internal': ['nei', 'neigong', 'inside', 'within', 'interior'],
			'external': ['wai', 'outside', 'surface', 'external'],
			
			// Body mechanics
			'posture': ['stance', 'position', 'alignment', 'structure'],
			'movement': ['motion', 'technique', 'form', 'method'],
			'breathing': ['breath', 'qi', 'respiration', 'inhale', 'exhale'],
			
			// Training concepts
			'practice': ['training', 'cultivation', 'exercise', 'drill'],
			'meditation': ['sitting', 'stillness', 'mindfulness', 'concentration'],
			'application': ['usage', 'technique', 'method', 'implementation'],

			// Martial arts styles
			'taiji': ['tai chi', 'taijiquan', 'supreme ultimate'],
			'xingyi': ['hsing-i', 'shape intent', 'form intention'],
			'bagua': ['pa kua', 'eight trigrams', 'circle walking']
		};

		// Check for conceptual matches
		queryWords.forEach(word => {
			if (conceptMap[word]) {
				conceptMap[word].forEach(concept => {
					const escapedConcept = escapeRegex(concept);
					const regex = new RegExp(`[^.!?]*\\b${escapedConcept}\\b[^.!?]*[.!?]`, 'gi');
					const matches = content.match(regex) || [];
					if (matches.length > 0) {
						score += matches.length * 0.5; // Lower weight than direct matches
						matches.slice(0, 1).forEach(match => excerpts.add(match.trim()));
						relationship.push(`${word} → ${concept}`);
					}
				});
			}
		});

		// Look for term relationships
		terms.forEach(term => {
			if (term.info && term.info.relatedTerms) {
				term.info.relatedTerms.forEach(relatedTerm => {
					const escapedRelatedTerm = escapeRegex(relatedTerm);
					const regex = new RegExp(`[^.!?]*\\b${escapedRelatedTerm}\\b[^.!?]*[.!?]`, 'gi');
					const matches = content.match(regex) || [];
					if (matches.length > 0) {
						score += matches.length * 0.7;
						matches.slice(0, 1).forEach(match => excerpts.add(match.trim()));
						relationship.push(`${term.standard} → ${relatedTerm}`);
					}
				});
			}
		});

		return {
			score,
			excerpts: Array.from(excerpts),
			relationship
		};
	}

	calculateRelevance(content, query, terms) {
		let score = 0;
		const excerpts = new Set();

		// Helper function to escape regex special characters
		const escapeRegex = (string) => {
			return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		};

		// Check for term matches first (higher priority)
		terms.forEach((term) => {
			const escapedTerm = escapeRegex(term.standard);
			const regex = new RegExp(
				`[^.!?]*\\b${escapedTerm}\\b[^.!?]*[.!?]`,
				'gi'
			);
			const matches = content.match(regex) || [];
			score += matches.length * 2; // Weight term matches higher
			matches.slice(0, 2).forEach((match) => excerpts.add(match.trim()));
		});

		// Check for query word matches
		const words = query.toLowerCase().split(/\s+/);
		words.forEach((word) => {
			const escapedWord = escapeRegex(word);
			const regex = new RegExp(`[^.!?]*\\b${escapedWord}\\b[^.!?]*[.!?]`, 'gi');
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
