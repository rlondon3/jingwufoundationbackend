#!/usr/bin/env node
/**
 * PDF Resources Import Script
 * - Scans assets/resources directory for PDF files
 * - Adds them to the resources table with proper file paths
 * - Safe to re-run (won't create duplicates)
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

class PDFResourceImporter {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 5,
        });
    }

    async importPDFResources() {
        console.log('🔍 Scanning for PDF files in assets/resources...');
        
        try {
            const resourcesDir = path.join(__dirname, '../src/assets/resources');
            
            // Check if directory exists
            try {
                await fs.access(resourcesDir);
            } catch (error) {
                console.log(`⚠️  Resources directory not found: ${resourcesDir}`);
                return;
            }
            
            // Get new PDF files that need importing
            const newPDFFiles = await this.getNewPDFFiles(resourcesDir);
            
            if (newPDFFiles.length === 0) {
                console.log('✅ No new PDF files to import - all PDFs are already in database');
                return;
            }
            
            console.log(`📚 Found ${newPDFFiles.length} new PDF files to import`);
            
            // Process each new PDF file
            for (const pdfFile of newPDFFiles) {
                await this.processPDFFile(pdfFile, resourcesDir);
            }
            
            console.log('✅ PDF import completed!');
            
        } catch (error) {
            console.error('❌ Error importing PDF resources:', error);
            throw error;
        }
    }

    async getNewPDFFiles(resourcesDir) {
        try {
            // Get all PDF files from directory
            const files = await fs.readdir(resourcesDir);
            const allPDFFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
            
            if (allPDFFiles.length === 0) {
                return [];
            }
            
            // Get existing PDF file paths from database
            const existingPDFs = await this.pool.query(
                'SELECT file_path FROM resources WHERE type = $1 AND file_path IS NOT NULL',
                ['pdf']
            );
            
            const existingFilePaths = new Set(
                existingPDFs.rows.map(row => path.basename(row.file_path))
            );
            
            // Filter out PDFs that are already in database
            const newPDFFiles = allPDFFiles.filter(fileName => 
                !existingFilePaths.has(fileName)
            );
            
            return newPDFFiles;
            
        } catch (error) {
            console.error('Error checking for new PDF files:', error);
            return [];
        }
    }

    async processPDFFile(fileName, resourcesDir) {
        try {
            const filePath = path.join(resourcesDir, fileName);
            const relativePath = `src/assets/resources/${fileName}`;
            
            // Get file stats
            const stats = await fs.stat(filePath);
            const fileSize = stats.size;
            
            // Create a clean title from filename
            const title = this.createTitleFromFilename(fileName);
            
            // Check if this resource already exists
            const existingResource = await this.pool.query(
                'SELECT id FROM resources WHERE file_path = $1 OR title = $2',
                [relativePath, title]
            );
            
            if (existingResource.rows.length > 0) {
                console.log(`⏭️  Skipping ${fileName} - already exists`);
                return;
            }
            
            // Insert new PDF resource
            const sql = `
                INSERT INTO resources (
                    title, type, file_path, file_size, mime_type, 
                    author, description, is_published, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
                RETURNING id, title
            `;
            
            const result = await this.pool.query(sql, [
                title,
                'pdf',
                relativePath,
                fileSize,
                'application/pdf',
                'Traditional Masters', // Default author for PDFs
                `PDF resource: ${title}`,
                true // Published by default
            ]);
            
            console.log(`✅ Added: ${title} (ID: ${result.rows[0].id})`);
            
        } catch (error) {
            console.error(`❌ Error processing ${fileName}:`, error);
            // Continue with other files
        }
    }

    createTitleFromFilename(fileName) {
        // Remove .pdf extension
        let title = fileName.replace(/\.pdf$/i, '');
        
        // Replace underscores and hyphens with spaces
        title = title.replace(/[_-]/g, ' ');
        
        // Clean up common patterns
        title = title.replace(/\s*_\s*Brennan Translation/gi, ' (Brennan Translation)');
        title = title.replace(/\s*\(\d+\)\s*$/g, ''); // Remove (1), (2) etc at end
        title = title.replace(/\s+/g, ' '); // Multiple spaces to single space
        title = title.trim();
        
        // Capitalize first letter of each word
        title = title.replace(/\b\w/g, l => l.toUpperCase());
        
        // Handle special cases
        title = title.replace(/\bTaiji\b/gi, 'Taiji');
        title = title.replace(/\bXingyi\b/gi, 'Xingyi');
        title = title.replace(/\bChen\b/gi, 'Chen');
        title = title.replace(/\bWu\b/gi, 'Wu');
        title = title.replace(/\bSun\b/gi, 'Sun');
        title = title.replace(/\bYang\b/gi, 'Yang');
        
        return title;
    }

    async getImportStats() {
        const sql = `
            SELECT 
                COUNT(*) as total_pdfs,
                SUM(file_size) as total_size,
                MIN(created_at) as first_import,
                MAX(created_at) as last_import
            FROM resources 
            WHERE type = 'pdf'
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
    const importer = new PDFResourceImporter();
    
    try {
        // Check if there are new PDFs to import
        const resourcesDir = path.join(__dirname, '../src/assets/resources');
        const newPDFFiles = await importer.getNewPDFFiles(resourcesDir);
        
        if (newPDFFiles.length === 0) {
            console.log('✅ No new PDF files to import - database is up to date');
            return;
        }
        
        console.log(`🔄 Found ${newPDFFiles.length} new PDF files - starting import...`);
        
        await importer.importPDFResources();
        
        // Show final stats
        const stats = await importer.getImportStats();
        console.log('\n📊 Import Complete - PDF Stats:');
        console.log(`   Total PDFs: ${stats.total_pdfs}`);
        console.log(`   Total Size: ${Math.round(stats.total_size / 1024 / 1024)}MB`);
        if (stats.first_import) {
            console.log(`   First Import: ${new Date(stats.first_import).toLocaleString()}`);
        }
        
    } catch (error) {
        console.error('❌ PDF import failed:', error);
        // Don't exit with error code to prevent app startup failure
        console.log('⚠️  App will continue without new PDFs imported');
    } finally {
        await importer.close();
    }
}

// Auto-startup check function for app initialization
async function checkAndImportPDFs() {
    console.log('🔍 Checking for new PDF files to import...');
    await main();
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { PDFResourceImporter, checkAndImportPDFs };