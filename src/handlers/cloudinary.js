// handlers/cloudinary.js
require('dotenv').config();
const { authenticationToken, requireAdmin } = require('../middleware/auth');

/**
 * Delete image from Cloudinary using Admin API
 */
const deleteImageDirect = async (publicId) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    
    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error('Cloudinary credentials not configured');
    }
    
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`;
    
    // Create signature for authentication
    const crypto = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');
    
    const formData = new URLSearchParams();
    formData.append('public_id', publicId);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
    });
    
    if (!response.ok) {
        const errorData = await response.text();
        console.error('Cloudinary deletion failed:', response.status, errorData);
        throw new Error(`Cloudinary deletion failed: ${response.status}`);
    }
    
    return response.json();
};

/**
 * Extract public ID from Cloudinary URL
 * URL format: https://res.cloudinary.com/cloud-name/image/upload/v1234567890/folder/public-id.jpg
 */
const extractPublicIdFromUrl = (url) => {
    try {
        const urlParts = url.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        
        if (uploadIndex === -1 || uploadIndex >= urlParts.length - 1) {
            return null;
        }
        
        // Get everything after 'upload/v1234567890/' or 'upload/'
        const pathAfterUpload = urlParts.slice(uploadIndex + 1);
        
        // Remove version number if present (starts with 'v' followed by digits)
        const startIndex = pathAfterUpload[0].match(/^v\d+$/) ? 1 : 0;
        
        // Join the remaining parts and remove file extension
        const publicIdWithExtension = pathAfterUpload.slice(startIndex).join('/');
        const publicId = publicIdWithExtension.replace(/\.[^/.]+$/, '');
        
        return publicId;
    } catch (error) {
        console.error('Error extracting public ID from URL:', error);
        return null;
    }
};

/**
 * Delete Cloudinary image by URL
 * DELETE /admin/cloudinary/delete
 */
const deleteImage = async (req, res) => {
    try {
        const { imageUrl, publicId } = req.body;
        
        let targetPublicId = publicId;
        
        // If publicId not provided, extract from URL
        if (!targetPublicId && imageUrl) {
            targetPublicId = extractPublicIdFromUrl(imageUrl);
        }
        
        if (!targetPublicId) {
            return res.status(400).json({ 
                error: 'Either publicId or imageUrl is required' 
            });
        }
        
        console.log('Deleting Cloudinary image:', targetPublicId);
        
        const result = await deleteImageDirect(targetPublicId);
        
        return res.status(200).json({
            message: 'Image deleted successfully',
            publicId: targetPublicId,
            result: result
        });
        
    } catch (error) {
        console.error('Delete image error:', error);
        return res.status(500).json({ 
            error: 'Failed to delete image from Cloudinary',
            details: error.message 
        });
    }
};

/**
 * Delete multiple Cloudinary images
 * DELETE /admin/cloudinary/delete-multiple
 */
const deleteMultipleImages = async (req, res) => {
    try {
        const { imageUrls, publicIds } = req.body;
        
        let targetPublicIds = publicIds || [];
        
        // If publicIds not provided, extract from URLs
        if (targetPublicIds.length === 0 && imageUrls && imageUrls.length > 0) {
            targetPublicIds = imageUrls
                .map(url => extractPublicIdFromUrl(url))
                .filter(id => id !== null);
        }
        
        if (targetPublicIds.length === 0) {
            return res.status(400).json({ 
                error: 'Either publicIds or imageUrls array is required' 
            });
        }
        
        console.log('Deleting multiple Cloudinary images:', targetPublicIds);
        
        const results = [];
        const errors = [];
        
        for (const publicId of targetPublicIds) {
            try {
                const result = await deleteImageDirect(publicId);
                results.push({ publicId, success: true, result });
            } catch (error) {
                errors.push({ publicId, success: false, error: error.message });
            }
        }
        
        return res.status(200).json({
            message: `Processed ${targetPublicIds.length} images`,
            successful: results.length,
            failed: errors.length,
            results: results,
            errors: errors
        });
        
    } catch (error) {
        console.error('Delete multiple images error:', error);
        return res.status(500).json({ 
            error: 'Failed to delete images from Cloudinary',
            details: error.message 
        });
    }
};

/**
 * Cloudinary routes
 */
const cloudinary_routes = (app) => {
    // Admin-only routes for Cloudinary management
    app.delete('/admin/cloudinary/delete', authenticationToken, requireAdmin, deleteImage);
    app.delete('/admin/cloudinary/delete-multiple', authenticationToken, requireAdmin, deleteMultipleImages);
};

module.exports = cloudinary_routes;
module.exports.deleteImageDirect = deleteImageDirect;
module.exports.extractPublicIdFromUrl = extractPublicIdFromUrl;