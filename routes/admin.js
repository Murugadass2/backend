const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
require('dotenv').config();

// Middleware to verify Admin or Co-Admin
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Authorization required.' });
    }

    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.user_role !== 'admin' && decoded.user_role !== 'co_admin') {
            return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
        }

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
};

// Apply middleware to all admin routes
router.use(verifyAdmin);

// ─────────────────────────────────────────────
// GET /api/admin/stats
// ─────────────────────────────────────────────
router.get('/stats', async (req, res) => {
    try {
        const [[{ total_jobs }]] = await db.execute('SELECT COUNT(*) as total_jobs FROM jobs');
        const [[{ total_seekers }]] = await db.execute('SELECT COUNT(*) as total_seekers FROM users WHERE user_role = "job_seeker"');
        const [[{ total_providers }]] = await db.execute('SELECT COUNT(*) as total_providers FROM users WHERE user_role = "job_provider"');

        return res.json({
            success: true,
            stats: { total_jobs, total_seekers, total_providers }
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/users/:role
// ─────────────────────────────────────────────
router.get('/users/:role', async (req, res) => {
    try {
        const role = req.params.role;
        const dbRole = role === 'provider' ? 'job_provider' : 'job_seeker';

        const [users] = await db.execute(
            'SELECT id, full_name, email, is_verified, is_premium, created_at FROM users WHERE user_role = ? ORDER BY created_at DESC',
            [dbRole]
        );

        return res.json({ success: true, users });
    } catch (err) {
        console.error('Fetch users error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/premium-toggle
// ─────────────────────────────────────────────
router.post('/premium-toggle', async (req, res) => {
    try {
        const { userId, isPremium } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'User ID required' });

        await db.execute('UPDATE users SET is_premium = ? WHERE id = ?', [isPremium ? 1 : 0, userId]);

        return res.json({ success: true, message: `Premium status updated successfully.` });
    } catch (err) {
        console.error('Premium toggle error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/jobs
// ─────────────────────────────────────────────
router.post('/jobs', async (req, res) => {
    try {
        const { title, company, location, type, experience, salary, description, skills, logo } = req.body;

        if (!title || !company) {
            return res.status(400).json({ success: false, message: 'Title and company are required.' });
        }

        const skillsJson = JSON.stringify(skills || []);

        let savedLogo = logo || '💼';
        if (logo && logo.startsWith('data:image')) {
            const fs = require('fs');
            const path = require('path');
            const match = logo.match(/^data:image\/(\w+);base64,/);
            if (match) {
                const ext = match[1];
                const base64Data = logo.replace(/^data:image\/\w+;base64,/, "");
                const filename = `ad-${Date.now()}.${ext}`;
                const filepath = path.join(__dirname, '..', '..', 'frontend', 'uploads', filename);
                fs.writeFileSync(filepath, base64Data, 'base64');
                savedLogo = `uploads/${filename}`;
            }
        }

        await db.execute(
            `INSERT INTO jobs (title, company, location, type, experience, salary, description, skills, logo, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, company, location, type, experience, salary, description, skillsJson, savedLogo, req.user.id]
        );

        return res.json({ success: true, message: 'Job created successfully!' });
    } catch (err) {
        console.error('Create job error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/jobs
// ─────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
    try {
        const [jobs] = await db.execute('SELECT * FROM jobs ORDER BY created_at DESC');
        return res.json({ success: true, jobs });
    } catch (err) {
        console.error('Fetch jobs error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// DELETE /api/admin/jobs/:id (ONLY ADMIN, NO CO-ADMIN)
// ─────────────────────────────────────────────
router.delete('/jobs/:id', async (req, res) => {
    try {
        if (req.user.user_role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Permission denied. Only Super Admin can delete.' });
        }

        await db.execute('DELETE FROM jobs WHERE id = ?', [req.params.id]);
        return res.json({ success: true, message: 'Job deleted successfully.' });
    } catch (err) {
        console.error('Delete job error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// POST /api/admin/co-admins
// ─────────────────────────────────────────────
router.post('/co-admins', async (req, res) => {
    try {
        if (req.user.user_role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Permission denied. Only Super Admin can create Co-Admins.' });
        }

        const { full_name, email, password } = req.body;
        if (!full_name || !email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        await db.execute(
            'INSERT INTO users (full_name, email, password, is_verified, user_role) VALUES (?, ?, ?, 1, "co_admin")',
            [full_name, email, hashedPassword]
        );

        return res.json({ success: true, message: 'Co-Admin created successfully.' });
    } catch (err) {
        console.error('Create co-admin error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ─────────────────────────────────────────────
// GET /api/admin/co-admins
// ─────────────────────────────────────────────
router.get('/co-admins', async (req, res) => {
    try {
        const [users] = await db.execute(
            'SELECT id, full_name, email, created_at FROM users WHERE user_role = "co_admin" ORDER BY created_at DESC'
        );
        return res.json({ success: true, coAdmins: users });
    } catch (err) {
        console.error('Fetch co-admins error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
