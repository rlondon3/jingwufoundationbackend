const DatabaseBackupService = require('../service/databaseBackupService');
const cron = require('node-cron');
const { authenticationToken } = require('../middleware/auth');

const backupService = new DatabaseBackupService();

module.exports = (app) => {
	// Manual backup endpoint (admin only)
	app.post('/admin/backup', authenticationToken, async (req, res) => {
		// Ensure only admins can trigger manual backups
		if (!req.user.is_admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}
		try {
			const result = await backupService.createCompressedBackup();
			res.json({
				message: 'Backup completed successfully',
				...result,
			});
		} catch (error) {
			console.error('Manual backup failed:', error);
			res.status(500).json({
				error: 'Backup failed',
				message: error.message,
			});
		}
	});

	// Daily backup at 2 AM UTC
	cron.schedule('0 2 * * *', async () => {
		console.log('🔄 Running daily database backup...');
		try {
			const result = await backupService.createCompressedBackup();
			console.log(`✅ Daily backup completed: ${result.fileName}`);
		} catch (error) {
			console.error('❌ Daily backup failed:', error);
			// You might want to send an alert/notification here
		}
	});

	// Optional: Cleanup old backups (keep last 30 days) at 3 AM UTC
	cron.schedule('0 3 * * *', async () => {
		console.log('🔄 Running backup cleanup...');
		try {
			const result = await backupService.cleanupOldBackups(30); // Keep last 30 days
			console.log(`✅ Backup cleanup completed - deleted ${result.deletedCount} old backups`);
		} catch (error) {
			console.error('❌ Backup cleanup failed:', error);
		}
	});
};
