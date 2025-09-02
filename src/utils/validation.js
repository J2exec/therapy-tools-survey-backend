/**
 * Sanitize string input to prevent SQL injection and XSS
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/['"]/g, '') // Remove quotes that could break SQL
    .substring(0, 1000); // Limit length
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate that tags are from the allowed list
 */
function validateTags(tags) {
  const allowedTags = [
    // Setting tags
    'setting_inperson', 'setting_mostly_inperson', 'setting_mixed', 
    'setting_mostly_online', 'setting_online_only',
    
    // Profession tags
    'role_therapist', 'role_social_worker', 'role_psychologist',
    'role_school_counselor', 'role_student', 'role_clergy',
    'role_sud_counselor', 'role_peer_specialist', 'role_other',
    
    // Population tags
    'pop_children10u', 'pop_teens', 'pop_adults',
    'pop_couples', 'pop_families', 'pop_groups', 'pop_all_day',
    
    // Interest tags
    'interest_sandtray', 'interest_art', 'interest_feelings_wheel',
    'interest_humans', 'interest_tumbling', 'interest_jeopardy',
    'interest_bingo', 'interest_mandala',
    
    // Frequency tags
    'freq_daily', 'freq_weekly', 'freq_monthly', 'freq_occasionally',
    
    // Modality tags
    'mod_cbt', 'mod_dbt', 'mod_solutions', 'mod_expressive',
    'mod_emdr', 'mod_couples', 'mod_ifs', 'mod_eclectic', 'mod_other'
  ];
  
  const invalidTags = tags.filter(tag => !allowedTags.includes(tag));
  
  return {
    isValid: invalidTags.length === 0,
    invalidTags
  };
}

/**
 * Validate survey request structure
 */
function validateSurveyRequest(data) {
  const errors = [];
  
  // Required fields
  if (!data.email) {
    errors.push({ field: 'email', message: 'Email is required' });
  } else if (!isValidEmail(data.email)) {
    errors.push({ field: 'email', message: 'Invalid email format' });
  }
  
  if (!data.name) {
    errors.push({ field: 'name', message: 'Name is required' });
  }
  
  if (!data.surveyData) {
    errors.push({ field: 'surveyData', message: 'Survey data is required' });
  }
  
  if (!data.selectedTags || !Array.isArray(data.selectedTags)) {
    errors.push({ field: 'selectedTags', message: 'Selected tags must be an array' });
  } else {
    const tagValidation = validateTags(data.selectedTags);
    if (!tagValidation.isValid) {
      errors.push({ 
        field: 'selectedTags', 
        message: `Invalid tags: ${tagValidation.invalidTags.join(', ')}` 
      });
    }
  }
  
  if (!data.recommendations || !Array.isArray(data.recommendations)) {
    errors.push({ field: 'recommendations', message: 'Recommendations must be an array' });
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Rate limiting helper
 */
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.windowMs = 60 * 1000; // 1 minute
    this.maxRequests = 5;
  }
  
  isAllowed(identifier) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.requests.has(identifier)) {
      this.requests.set(identifier, []);
    }
    
    const userRequests = this.requests.get(identifier);
    
    // Remove old requests outside the window
    const recentRequests = userRequests.filter(timestamp => timestamp > windowStart);
    this.requests.set(identifier, recentRequests);
    
    if (recentRequests.length >= this.maxRequests) {
      return false;
    }
    
    // Add current request
    recentRequests.push(now);
    return true;
  }
  
  getRemainingRequests(identifier) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.requests.has(identifier)) {
      return this.maxRequests;
    }
    
    const userRequests = this.requests.get(identifier);
    const recentRequests = userRequests.filter(timestamp => timestamp > windowStart);
    
    return Math.max(0, this.maxRequests - recentRequests.length);
  }
}

// Create a singleton rate limiter
const rateLimiter = new RateLimiter();

module.exports = {
  sanitizeInput,
  isValidEmail,
  validateTags,
  validateSurveyRequest,
  rateLimiter
};
