const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { sendOTPEmail } = require('../utils/mailer');
const { generateOTP, getOTPExpiry } = require('../utils/otp');
require('dotenv').config();

// ─────────────────────────────────────────────
// POST /api/signup
// ─────────────────────────────────────────────
router.post('/signup', async (req, res) => {
    try {
        const { full_name, email, password } = req.body;

        if (!full_name || !email || !password)
            return res.status(400).json({ success: false, message: 'All fields are required' });

        if (password.length < 6)
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

        // Check if email already exists and is verified
        const [existing] = await db.execute('SELECT id, is_verified FROM users WHERE email = ?', [email]);
        if (existing.length > 0 && existing[0].is_verified)
            return res.status(409).json({ success: false, message: 'Email already registered. Please login.' });

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert or update unverified user
        if (existing.length > 0 && !existing[0].is_verified) {
            await db.execute(
                'UPDATE users SET full_name = ?, password = ? WHERE email = ?',
                [full_name, hashedPassword, email]
            );
        } else {
            await db.execute(
                'INSERT INTO users (full_name, email, password, is_verified) VALUES (?, ?, ?, 0)',
                [full_name, email, hashedPassword]
            );
        }

        // Delete previous OTPs for this email
        await db.execute('DELETE FROM otp_verifications WHERE email = ?', [email]);

        // Generate & store new OTP
        const otp = generateOTP();
        const expiry = getOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES || 10));
        await db.execute(
            'INSERT INTO otp_verifications (email, otp, expires_at) VALUES (?, ?, ?)',
            [email, otp, expiry]
        );

        // Send email (graceful fallback if email not configured)
        let emailSent = false;
        try {
            await sendOTPEmail(email, otp);
            emailSent = true;
        } catch (emailErr) {
            console.warn('⚠️  Email sending failed:', emailErr.message);
            console.log(`📋 OTP for ${email}: ${otp} (use this to verify)`);
        }

        const msg = emailSent
            ? 'OTP sent to your email. Please verify.'
            : `OTP generated! Check server console for OTP (email not configured). OTP: ${otp}`;
        return res.json({ success: true, message: msg });
    } catch (err) {
        console.error('Signup error:', err);
        return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/verify-otp
// ─────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp)
            return res.status(400).json({ success: false, message: 'Email and OTP are required' });

        // Fetch latest OTP for this email
        const [rows] = await db.execute(
            'SELECT * FROM otp_verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1',
            [email]
        );

        if (rows.length === 0)
            return res.status(400).json({ success: false, message: 'No OTP found. Please sign up again.' });

        const record = rows[0];

        // Check expiry
        if (new Date() > new Date(record.expires_at))
            return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });

        // Check OTP match
        if (record.otp !== otp.toString())
            return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });

        // Mark user as verified
        await db.execute('UPDATE users SET is_verified = 1 WHERE email = ?', [email]);

        // Clean up OTP record
        await db.execute('DELETE FROM otp_verifications WHERE email = ?', [email]);

        return res.json({ success: true, message: 'Email verified successfully! You can now login.' });
    } catch (err) {
        console.error('Verify OTP error:', err);
        return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/resend-otp
// ─────────────────────────────────────────────
router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email)
            return res.status(400).json({ success: false, message: 'Email is required' });

        const [user] = await db.execute('SELECT id, is_verified FROM users WHERE email = ?', [email]);

        if (user.length === 0)
            return res.status(404).json({ success: false, message: 'User not found. Please sign up.' });

        if (user[0].is_verified)
            return res.status(400).json({ success: false, message: 'Account already verified. Please login.' });

        // Delete old OTP
        await db.execute('DELETE FROM otp_verifications WHERE email = ?', [email]);

        // Generate new OTP
        const otp = generateOTP();
        const expiry = getOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES || 10));
        await db.execute(
            'INSERT INTO otp_verifications (email, otp, expires_at) VALUES (?, ?, ?)',
            [email, otp, expiry]
        );

        let emailSent = false;
        try {
            await sendOTPEmail(email, otp);
            emailSent = true;
        } catch (emailErr) {
            console.warn('⚠️  Email sending failed:', emailErr.message);
            console.log(`📋 OTP for ${email}: ${otp} (use this to verify)`);
        }

        const msg = emailSent
            ? 'New OTP sent to your email.'
            : `New OTP generated! OTP: ${otp}`;
        return res.json({ success: true, message: msg });
    } catch (err) {
        console.error('Resend OTP error:', err);
        return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/login
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password)
            return res.status(400).json({ success: false, message: 'Email and password are required' });

        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0)
            return res.status(401).json({ success: false, message: 'Invalid email or password' });

        const user = users[0];

        if (!user.is_verified)
            return res.status(401).json({ success: false, message: 'Email not verified. Please check your inbox.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
            return res.status(401).json({ success: false, message: 'Invalid email or password' });

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, full_name: user.full_name, user_role: user.user_role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Check if profile exists (if job seeker)
        let profileCompleted = false;
        if (user.user_role === 'job_seeker') {
            const [profiles] = await db.execute('SELECT id FROM job_seeker_profiles WHERE user_id = ?', [user.id]);
            profileCompleted = profiles.length > 0;
        }

        return res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                user_role: user.user_role || null,
                profile_completed: profileCompleted
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/set-role
// ─────────────────────────────────────────────
router.post('/set-role', async (req, res) => {
    try {
        const { role } = req.body;

        if (!role || !['job_seeker', 'job_provider'].includes(role))
            return res.status(400).json({ success: false, message: 'Invalid role. Must be job_seeker or job_provider.' });

        // Get user from JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return res.status(401).json({ success: false, message: 'Authorization required.' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Update user role in database
        await db.execute('UPDATE users SET user_role = ? WHERE id = ?', [role, decoded.id]);

        return res.json({ success: true, message: 'Role saved successfully!' });
    } catch (err) {
        console.error('Set role error:', err);
        return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/send-phone-otp
// ─────────────────────────────────────────────
router.post('/send-phone-otp', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone || phone.replace(/\D/g, '').length < 10)
            return res.status(400).json({ success: false, message: 'Valid phone number required.' });

        // Auth check
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return res.status(401).json({ success: false, message: 'Authorization required.' });

        const token = authHeader.split(' ')[1];
        jwt.verify(token, process.env.JWT_SECRET);

        // Delete old OTPs
        await db.execute('DELETE FROM phone_otp WHERE phone = ?', [phone]);

        // Generate OTP
        const otp = generateOTP();
        const expiry = getOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES || 10));
        await db.execute(
            'INSERT INTO phone_otp (phone, otp, expires_at) VALUES (?, ?, ?)',
            [phone, otp, expiry]
        );

        // For now, show OTP in response (SMS integration can be added later)
        console.log(`📱 Phone OTP for ${phone}: ${otp}`);
        return res.json({ success: true, message: `OTP sent! OTP: ${otp}` });
    } catch (err) {
        console.error('Send phone OTP error:', err);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/verify-phone-otp
// ─────────────────────────────────────────────
router.post('/verify-phone-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp)
            return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return res.status(401).json({ success: false, message: 'Authorization required.' });

        const token = authHeader.split(' ')[1];
        jwt.verify(token, process.env.JWT_SECRET);

        const [rows] = await db.execute(
            'SELECT * FROM phone_otp WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
            [phone]
        );

        if (rows.length === 0)
            return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });

        const record = rows[0];

        if (new Date() > new Date(record.expires_at))
            return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });

        if (record.otp !== otp.toString())
            return res.status(400).json({ success: false, message: 'Invalid OTP.' });

        // Clean up
        await db.execute('DELETE FROM phone_otp WHERE phone = ?', [phone]);

        return res.json({ success: true, message: 'Phone number verified!' });
    } catch (err) {
        console.error('Verify phone OTP error:', err);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/save-profile
// ─────────────────────────────────────────────
router.post('/save-profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer '))
            return res.status(401).json({ success: false, message: 'Authorization required.' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verify user still exists in database
        const [userCheck] = await db.execute('SELECT id FROM users WHERE id = ?', [decoded.id]);
        if (userCheck.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found. Please sign out and login again.' });
        }

        const {
            full_name, date_of_birth, father_name, highest_qualification,
            current_location, country, state, district, full_address,
            company_name, preferred_job_locations, phone_number, phone_verified
        } = req.body;

        if (!full_name || !date_of_birth || !phone_number)
            return res.status(400).json({ success: false, message: 'Full name, DOB, and phone are required.' });

        if (!phone_verified)
            return res.status(400).json({ success: false, message: 'Phone number must be verified.' });

        const locationsJSON = JSON.stringify(preferred_job_locations || []);

        // Upsert profile
        const [existing] = await db.execute('SELECT id FROM job_seeker_profiles WHERE user_id = ?', [decoded.id]);

        if (existing.length > 0) {
            await db.execute(
                `UPDATE job_seeker_profiles SET
                    full_name=?, date_of_birth=?, current_location=?, country=?, state=?,
                    district=?, full_address=?, father_name=?, highest_qualification=?,
                    preferred_job_locations=?, phone_number=?, phone_verified=?, company_name=?
                WHERE user_id=?`,
                [full_name, date_of_birth, current_location, country, state,
                    district, full_address, father_name, highest_qualification,
                    locationsJSON, phone_number, phone_verified ? 1 : 0, company_name, decoded.id]
            );
        } else {
            await db.execute(
                `INSERT INTO job_seeker_profiles
                    (user_id, full_name, date_of_birth, current_location, country, state,
                     district, full_address, father_name, highest_qualification,
                     preferred_job_locations, phone_number, phone_verified, company_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [decoded.id, full_name, date_of_birth, current_location, country, state,
                    district, full_address, father_name, highest_qualification,
                    locationsJSON, phone_number, phone_verified ? 1 : 0, company_name]
            );
        }

        return res.json({ success: true, message: 'Profile saved successfully!' });
    } catch (err) {
        console.error('Save profile error:', err);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/auth/jobs
// ─────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        let isPremium = false;
        let role = 'guest';

        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const [users] = await db.execute('SELECT is_premium FROM users WHERE id = ?', [decoded.id]);
                if (users.length > 0) {
                    isPremium = Boolean(users[0].is_premium);
                    role = decoded.user_role;
                }
            } catch (e) {
                console.warn("Invalid token for jobs fetch", e.message);
            }
        }

        const [jobs] = await db.execute('SELECT * FROM jobs ORDER BY created_at DESC');

        // Ensure image paths are resolved for frontend view if needed
        const mappedJobs = jobs.map(j => ({
            ...j,
            logo: (j.logo && j.logo.startsWith('uploads/')) ? `/${j.logo}` : j.logo,
            skills: typeof j.skills === 'string' ? JSON.parse(j.skills) : (j.skills || [])
        }));

        let returnedJobs = mappedJobs;
        let hasMore = false;

        // If job seeker and not premium, limit to 3 jobs
        if (role === 'job_seeker' && !isPremium) {
            if (mappedJobs.length > 3) {
                returnedJobs = mappedJobs.slice(0, 3);
                hasMore = true;
            }
        }

        return res.json({ success: true, jobs: returnedJobs, isPremium, hasMore });
    } catch (err) {
        console.error('Fetch jobs error:', err);
        return res.status(500).json({ success: false, message: 'Server error fetching jobs.' });
    }
});

module.exports = router;
