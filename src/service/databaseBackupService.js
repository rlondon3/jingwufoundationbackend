const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class DatabaseBackupService {
	constructor() {
		this.s3Client = new S3Client({
			region: process.env.AWS_REGION,
			credentials: {
				accessKeyId: process.env.AWS_ACCESS_KEY_ID,
				secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
			},
		});
		this.bucketName = process.env.S3_BUCKET_NAME;
		this.databaseUrl = process.env.DATABASE_URL;
	}

	async createBackup() {
		try {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `db-backup-${timestamp}.sql`;
			const s3Key = `backups/${fileName}`;

			console.log('Starting database backup...');

			// Create pg_dump command
			const dumpCommand = `pg_dump "${this.databaseUrl}" --no-owner --no-privileges`;

			// Execute pg_dump
			const { stdout: sqlDump } = await execAsync(dumpCommand);

			// Upload to S3
			const uploadCommand = new PutObjectCommand({
				Bucket: this.bucketName,
				Key: s3Key,
				Body: sqlDump,
				ContentType: 'application/sql',
				ServerSideEncryption: 'AES256', // Optional: encrypt at rest
			});

			const result = await this.s3Client.send(uploadCommand);

			console.log(`Backup completed successfully: ${s3Key}`);
			return {
				success: true,
				fileName: s3Key,
				uploadId: result.ETag,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			console.error('Backup failed:', error);
			throw error;
		}
	}

	// Optional: Compressed backup
	async createCompressedBackup() {
		try {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const fileName = `db-backup-${timestamp}.sql.gz`;
			const s3Key = `backups/${fileName}`;

			console.log('Starting compressed database backup...');

			// Create pg_dump command with gzip compression
			const dumpCommand = `pg_dump "${this.databaseUrl}" --no-owner --no-privileges | gzip`;

			// Execute pg_dump with compression
			const { stdout: compressedDump } = await execAsync(dumpCommand, {
				encoding: 'buffer', // Important for binary data
			});

			// Upload to S3
			const uploadCommand = new PutObjectCommand({
				Bucket: this.bucketName,
				Key: s3Key,
				Body: compressedDump,
				ContentType: 'application/gzip',
				ServerSideEncryption: 'AES256',
			});

			const result = await this.s3Client.send(uploadCommand);

			console.log(`Compressed backup completed: ${s3Key}`);
			return {
				success: true,
				fileName: s3Key,
				uploadId: result.ETag,
				timestamp: new Date().toISOString(),
			};
		} catch (error) {
			console.error('Compressed backup failed:', error);
			throw error;
		}
	}
	// Cleanup old backups
	async cleanupOldBackups(retentionDays = 30) {
		try {
			const {
				ListObjectsV2Command,
				DeleteObjectCommand,
			} = require('@aws-sdk/client-s3');

			// List all backup files
			const listCommand = new ListObjectsV2Command({
				Bucket: this.bucketName,
				Prefix: 'backups/',
			});

			const response = await this.s3Client.send(listCommand);

			if (!response.Contents) return;

			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

			const filesToDelete = response.Contents.filter(
				(object) => new Date(object.LastModified) < cutoffDate
			);

			console.log(`Found ${filesToDelete.length} old backups to delete`);

			// Delete old files
			for (const file of filesToDelete) {
				const deleteCommand = new DeleteObjectCommand({
					Bucket: this.bucketName,
					Key: file.Key,
				});

				await this.s3Client.send(deleteCommand);
				console.log(`Deleted old backup: ${file.Key}`);
			}

			return {
				deletedCount: filesToDelete.length,
				retentionDays,
			};
		} catch (error) {
			console.error('Cleanup failed:', error);
			throw error;
		}
	}
}

module.exports = DatabaseBackupService;
