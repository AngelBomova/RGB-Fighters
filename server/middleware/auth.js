import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function signToken(userId, username) {
  return jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifySocketToken(token) {
  if (!token) throw new Error('No token');
  return jwt.verify(token, JWT_SECRET);
}
