/**
 * Parses a prerequisite string into an array of course codes.
 * Example: "DS-UA 111 or DS-UA 112" => ["DS-UA 111", "DS-UA 112"]
 */
function extractCourseCodes(prereqString) {
    if (!prereqString || typeof prereqString !== 'string') return [];
  
    // Match things like "DS-UA 111", "CS-UY 1134"
    const courseCodeRegex = /[A-Z]{2,}-[A-Z]{2,} \d{3,4}/g;
    const matches = prereqString.match(courseCodeRegex);
    return matches || [];
  }
  
  /**
   * Filters out courses that the student cannot take yet.
   * Only returns courses where the student has met all prerequisites.
   */
  function getEligibleCourses(student, availableCourses) {
    const takenCourseCodes = new Set(student.courses.map(c => c.code));
  
    const eligible = availableCourses.filter(course => {
      const prereqs = extractCourseCodes(course.prereqs || '');
  
      // Already took it? Skip
      if (takenCourseCodes.has(course.code)) return false;
  
      // If no prereqs, it's eligible
      if (prereqs.length === 0) return true;
  
      // Student must have taken ALL prereqs
      return prereqs.every(code => takenCourseCodes.has(code));
    });
  
    return eligible;
  }
  
  module.exports = { getEligibleCourses };  