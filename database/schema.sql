-- Database Schema for Therapy Tools Survey Hub
-- Run this script to create the required tables

-- Table to store complete survey responses
CREATE TABLE SurveyResponses (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    TherapistId NVARCHAR(255) NOT NULL,
    Email NVARCHAR(255) NOT NULL,
    Name NVARCHAR(255),
    SurveyData NVARCHAR(MAX), -- JSON blob of complete survey
    Recommendations NVARCHAR(MAX), -- JSON array of tool recommendations
    CustomResponses NVARCHAR(MAX), -- JSON blob for free text responses (profession_other, modality_other)
    CompletedAt DATETIME2 DEFAULT GETDATE(),
    KitSyncStatus NVARCHAR(50) DEFAULT 'pending', -- 'success', 'failed', 'pending'
    KitSyncedAt DATETIME2 NULL,
    CreatedAt DATETIME2 DEFAULT GETDATE(),
    UpdatedAt DATETIME2 DEFAULT GETDATE(),
    
    INDEX IX_SurveyResponses_Email (Email),
    INDEX IX_SurveyResponses_TherapistId (TherapistId),
    INDEX IX_SurveyResponses_CompletedAt (CompletedAt),
    INDEX IX_SurveyResponses_KitSyncStatus (KitSyncStatus)
);

-- Table to store individual user tags
CREATE TABLE UserTags (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    TherapistId NVARCHAR(255) NOT NULL,
    Email NVARCHAR(255) NOT NULL,
    TagName NVARCHAR(100) NOT NULL,
    TagSource NVARCHAR(50) DEFAULT 'survey', -- 'survey', 'manual', 'import'
    CreatedAt DATETIME2 DEFAULT GETDATE(),
    UpdatedAt DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT UQ_UserTags_Email_TagName UNIQUE(Email, TagName),
    INDEX IX_UserTags_Email (Email),
    INDEX IX_UserTags_TherapistId (TherapistId),
    INDEX IX_UserTags_TagName (TagName),
    INDEX IX_UserTags_TagSource (TagSource)
);

-- Table to track failed Kit.com sync attempts for retry logic
CREATE TABLE KitSyncFailures (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    SurveyResponseId INT NOT NULL,
    Email NVARCHAR(255) NOT NULL,
    FailureReason NVARCHAR(MAX),
    RetryCount INT DEFAULT 0,
    LastRetryAt DATETIME2 NULL,
    CreatedAt DATETIME2 DEFAULT GETDATE(),
    
    FOREIGN KEY (SurveyResponseId) REFERENCES SurveyResponses(Id),
    INDEX IX_KitSyncFailures_Email (Email),
    INDEX IX_KitSyncFailures_RetryCount (RetryCount),
    INDEX IX_KitSyncFailures_LastRetryAt (LastRetryAt)
);

-- Add trigger to update UpdatedAt timestamps
CREATE TRIGGER TR_SurveyResponses_UpdatedAt
ON SurveyResponses
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE SurveyResponses 
    SET UpdatedAt = GETDATE() 
    WHERE Id IN (SELECT DISTINCT Id FROM Inserted);
END;

CREATE TRIGGER TR_UserTags_UpdatedAt
ON UserTags
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE UserTags 
    SET UpdatedAt = GETDATE() 
    WHERE Id IN (SELECT DISTINCT Id FROM Inserted);
END;

-- Insert some sample data for testing (optional)
/*
INSERT INTO SurveyResponses (TherapistId, Email, Name, SurveyData, Recommendations, KitSyncStatus)
VALUES 
('test@example.com', 'test@example.com', 'Test User', 
 '{"setting":"setting_mixed","profession":"role_therapist","populations":["pop_adults"],"interests":["interest_art"],"frequency":"freq_weekly","modalities":["mod_cbt"]}',
 '["Creative Canvas","Feelings Wheel"]', 
 'success');

INSERT INTO UserTags (TherapistId, Email, TagName, TagSource)
VALUES 
('test@example.com', 'test@example.com', 'setting_mixed', 'survey'),
('test@example.com', 'test@example.com', 'role_therapist', 'survey'),
('test@example.com', 'test@example.com', 'pop_adults', 'survey'),
('test@example.com', 'test@example.com', 'interest_art', 'survey'),
('test@example.com', 'test@example.com', 'freq_weekly', 'survey'),
('test@example.com', 'test@example.com', 'mod_cbt', 'survey');
*/

-- Useful queries for monitoring and debugging:

-- Check survey responses by sync status
-- SELECT KitSyncStatus, COUNT(*) as Count FROM SurveyResponses GROUP BY KitSyncStatus;

-- View recent survey submissions
-- SELECT TOP 10 Email, Name, CompletedAt, KitSyncStatus FROM SurveyResponses ORDER BY CompletedAt DESC;

-- View tags for a specific user
-- SELECT TagName, TagSource, CreatedAt FROM UserTags WHERE Email = 'user@example.com' ORDER BY CreatedAt DESC;

-- Find failed syncs that need retry
-- SELECT Id, Email, CompletedAt FROM SurveyResponses WHERE KitSyncStatus = 'failed' ORDER BY CompletedAt ASC;

-- Count tags by type
-- SELECT 
--   CASE 
--     WHEN TagName LIKE 'setting_%' THEN 'Setting'
--     WHEN TagName LIKE 'role_%' THEN 'Profession'
--     WHEN TagName LIKE 'pop_%' THEN 'Population'
--     WHEN TagName LIKE 'interest_%' THEN 'Interest'
--     WHEN TagName LIKE 'freq_%' THEN 'Frequency'
--     WHEN TagName LIKE 'mod_%' THEN 'Modality'
--     ELSE 'Other'
--   END as TagCategory,
--   COUNT(*) as TagCount
-- FROM UserTags 
-- GROUP BY 
--   CASE 
--     WHEN TagName LIKE 'setting_%' THEN 'Setting'
--     WHEN TagName LIKE 'role_%' THEN 'Profession'
--     WHEN TagName LIKE 'pop_%' THEN 'Population'
--     WHEN TagName LIKE 'interest_%' THEN 'Interest'
--     WHEN TagName LIKE 'freq_%' THEN 'Frequency'
--     WHEN TagName LIKE 'mod_%' THEN 'Modality'
--     ELSE 'Other'
--   END
-- ORDER BY TagCount DESC;
