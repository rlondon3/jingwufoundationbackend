#!/usr/bin/env node
/**
 * Smart Content Processing Script
 * - Processes all unprocessed resources into content chunks
 * - Handles PDFs, text content, and other resource types
 * - Can be run multiple times safely (only processes new/updated resources)
 * - Run this whenever you add new resources
 */

require('dotenv').config();
const { Pool } = require('pg');
const PDFProcessor = require('../src/utilis/pdfPRocessor');
const TermNormalizer = require('../src/utilis/termNormalizer');

class ContentChunkProcessor {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 5,
        });
        this.pdfProcessor = new PDFProcessor();
        this.termNormalizer = new TermNormalizer();
    }

    async processAllResources() {
        console.log('🚀 Starting content chunk processing...');
        
        try {
            // Get all resources that need processing (new or updated)
            const unprocessedResources = await this.getUnprocessedResources();
            
            console.log(`📊 Found ${unprocessedResources.length} resources to process`);
            
            for (const resource of unprocessedResources) {
                await this.processResource(resource);
            }
            
            console.log('✅ Content chunk processing completed!');
            
        } catch (error) {
            console.error('❌ Error processing content chunks:', error);
            throw error;
        }
    }

    async getUnprocessedResources() {
        const sql = `
            SELECT r.* 
            FROM resources r 
            WHERE r.is_published = true 
            AND r.type IN ('manual', 'blog', 'article', 'pdf')
            AND (
                -- New resources (never processed)
                NOT EXISTS (
                    SELECT 1 FROM content_chunks cc WHERE cc.resource_id = r.id
                )
                OR 
                -- Updated resources (content changed since last processing)
                r.updated_at > (
                    SELECT MAX(cc.created_at) FROM content_chunks cc WHERE cc.resource_id = r.id
                )
            )
            ORDER BY r.created_at ASC
        `;
        
        const result = await this.pool.query(sql);
        return result.rows;
    }

    async processResource(resource) {
        console.log(`📝 Processing: ${resource.title} (ID: ${resource.id}, Type: ${resource.type})`);
        
        try {
            // Delete existing chunks for this resource (in case of updates)
            await this.pool.query('DELETE FROM content_chunks WHERE resource_id = $1', [resource.id]);
            
            let textContent = '';
            
            // Extract text based on resource type
            if (resource.type === 'pdf' && resource.file_path) {
                // Process PDF file
                textContent = await this.processPDFResource(resource);
            } else if (resource.content) {
                // Use existing text content
                textContent = resource.content;
            } else {
                console.log(`⚠️  Skipping ${resource.title} - no content or file_path`);
                return;
            }
            
            if (!textContent || textContent.trim().length === 0) {
                console.log(`⚠️  No text content extracted from ${resource.title}`);
                return;
            }
            
            // Create chunks from the text content
            const chunks = this.createTextChunks(textContent, resource);
            
            // Save chunks to database
            for (let i = 0; i < chunks.length; i++) {
                await this.saveContentChunk(resource.id, chunks[i], i);
            }
            
            console.log(`✅ Processed ${resource.title}: ${chunks.length} chunks created`);
            
        } catch (error) {
            console.error(`❌ Error processing resource ${resource.title}:`, error);
            // Continue with other resources
        }
    }

    async processPDFResource(resource) {
        try {
            if (!resource.file_path) {
                throw new Error('No file_path provided for PDF resource');
            }
            
            // Extract just the filename from the file_path (PDFProcessor expects just the filename)
            const fileName = resource.file_path.split('/').pop();
            
            console.log(`📄 Extracting text from PDF: ${resource.file_path}`);
            
            // Extract text from PDF using getFileContent method
            const textContent = await this.pdfProcessor.getFileContent(fileName);
            
            return textContent;
            
        } catch (error) {
            console.error(`Error processing PDF ${resource.file_path}:`, error);
            return '';
        }
    }

    createTextChunks(text, resource) {
        // Clean and normalize text
        const cleanText = text.replace(/\s+/g, ' ').trim();
        
        const chunks = [];
        const maxChunkSize = 1500; // Characters per chunk (good for AI context)
        const overlapSize = 200; // Overlap between chunks for context continuity
        
        // Split into sentences for better chunk boundaries
        const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
        
        let currentChunk = '';
        let currentWordCount = 0;
        
        for (const sentence of sentences) {
            const sentenceText = sentence.trim() + '.';
            const sentenceWordCount = sentenceText.split(' ').length;
            
            // If adding this sentence would exceed chunk size, save current chunk
            if (currentChunk.length + sentenceText.length > maxChunkSize && currentChunk.length > 0) {
                // Extract keywords for this chunk
                const keywords = this.extractKeywords(currentChunk);
                const topicCategory = this.determineTopicCategory(currentChunk, resource);
                
                chunks.push({
                    text: currentChunk.trim(),
                    keywords: keywords,
                    topic_category: topicCategory,
                    word_count: currentWordCount
                });
                
                // Start new chunk with overlap from previous chunk
                const overlapText = this.getOverlapText(currentChunk, overlapSize);
                currentChunk = overlapText + ' ' + sentenceText;
                currentWordCount = overlapText.split(' ').length + sentenceWordCount;
            } else {
                currentChunk += ' ' + sentenceText;
                currentWordCount += sentenceWordCount;
            }
        }
        
        // Add the final chunk if it has content
        if (currentChunk.trim().length > 0) {
            const keywords = this.extractKeywords(currentChunk);
            const topicCategory = this.determineTopicCategory(currentChunk, resource);
            
            chunks.push({
                text: currentChunk.trim(),
                keywords: keywords,
                topic_category: topicCategory,
                word_count: currentWordCount
            });
        }
        
        return chunks;
    }

    extractKeywords(text) {
        // Use term normalizer to find Jingwu-specific terms
        const jingwuTerms = this.termNormalizer.findJingwuTerms(text);
        
        // Extract other important keywords (common martial arts terms, techniques, etc.)
        const commonKeywords = this.extractCommonKeywords(text);
        
        // Combine and deduplicate
        const allKeywords = [...new Set([...jingwuTerms, ...commonKeywords])];
        
        return allKeywords.slice(0, 20); // Limit to top 20 keywords
    }

    extractCommonKeywords(text) {
        const lowerText = text.toLowerCase();
        
        // Common martial arts and training terms
        const martialArtsTerms = [
            'technique', 'training', 'practice', 'movement', 'stance', 'form',
            'breathing', 'meditation', 'balance', 'strength', 'flexibility',
            'coordination', 'timing', 'distance', 'application', 'sparring',
            'defense', 'attack', 'counter', 'block', 'strike', 'kick',
            'throw', 'grappling', 'ground', 'standing', 'weapons',
            'philosophy', 'principle', 'concept', 'method', 'system'
        ];
        
        const foundTerms = martialArtsTerms.filter(term => 
            lowerText.includes(term.toLowerCase())
        );
        
        return foundTerms;
    }

    determineTopicCategory(text, resource) {
        const lowerText = text.toLowerCase();
        
        // Categorize based on content patterns
        if (lowerText.includes('stance') || lowerText.includes('posture') || lowerText.includes('position')) {
            return 'stances_postures';
        } else if (lowerText.includes('technique') || lowerText.includes('application') || lowerText.includes('move')) {
            return 'techniques';
        } else if (lowerText.includes('breathing') || lowerText.includes('meditation') || lowerText.includes('internal')) {
            return 'internal_training';
        } else if (lowerText.includes('philosophy') || lowerText.includes('principle') || lowerText.includes('concept')) {
            return 'philosophy_principles';
        } else if (lowerText.includes('exercise') || lowerText.includes('drill') || lowerText.includes('training')) {
            return 'exercises_drills';
        } else if (lowerText.includes('history') || lowerText.includes('origin') || lowerText.includes('tradition')) {
            return 'history_tradition';
        } else {
            return 'general';
        }
    }

    getOverlapText(text, overlapSize) {
        // Get the last few characters for context overlap
        if (text.length <= overlapSize) {
            return text;
        }
        
        const overlapText = text.slice(-overlapSize);
        
        // Try to break at a word boundary
        const lastSpaceIndex = overlapText.lastIndexOf(' ');
        if (lastSpaceIndex > overlapSize * 0.5) {
            return overlapText.slice(lastSpaceIndex + 1);
        }
        
        return overlapText;
    }

    async saveContentChunk(resourceId, chunk, chunkIndex) {
        const sql = `
            INSERT INTO content_chunks (
                resource_id, chunk_text, chunk_index, keywords, 
                topic_category, word_count, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        `;
        
        await this.pool.query(sql, [
            resourceId,
            chunk.text,
            chunkIndex,
            chunk.keywords,
            chunk.topic_category,
            chunk.word_count
        ]);
    }

    async getProcessingStats() {
        const sql = `
            SELECT 
                COUNT(DISTINCT resource_id) as total_resources,
                COUNT(*) as total_chunks,
                SUM(word_count) as total_words,
                COUNT(DISTINCT topic_category) as total_categories
            FROM content_chunks
        `;
        
        const result = await this.pool.query(sql);
        return result.rows[0];
    }

    async close() {
        await this.pool.end();
    }
}

// Main execution - Auto-startup mode
async function main() {
    const processor = new ContentChunkProcessor();
    
    try {
        // Check if there are any unprocessed resources
        const unprocessedResources = await processor.getUnprocessedResources();
        
        if (unprocessedResources.length === 0) {
            console.log('✅ No new resources to process - content chunks are up to date');
            return;
        }
        
        console.log(`🔄 Found ${unprocessedResources.length} new/updated resources - starting processing...`);
        
        await processor.processAllResources();
        
        // Show final stats
        const stats = await processor.getProcessingStats();
        console.log('\n📊 Processing Complete - Final Stats:');
        console.log(`   Resources Processed: ${stats.total_resources}`);
        console.log(`   Content Chunks Created: ${stats.total_chunks}`);
        console.log(`   Total Words: ${stats.total_words}`);
        console.log(`   Topic Categories: ${stats.total_categories}`);
        
    } catch (error) {
        console.error('❌ Content processing failed:', error);
        // Don't exit with error code to prevent app startup failure
        console.log('⚠️  App will continue without updated content chunks');
    } finally {
        await processor.close();
    }
}

// Auto-startup check function for app initialization
async function checkAndProcessContent() {
    console.log('🔍 Checking for new resources to process...');
    await main();
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { ContentChunkProcessor, checkAndProcessContent };