"""
YogaMate – AI Yoga Pose Correction Server
Flask + MediaPipe backend with pre-generated reference values.
"""

import os
import base64
import logging
import json
import time
import uuid
import shutil
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import cv2
import mediapipe as mp
from flask import Flask, render_template, request, jsonify, session
from flask_cors import CORS
from flask_compress import Compress
from werkzeug.security import generate_password_hash, check_password_hash

logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'yogamate-secret-key-change-in-production')
CORS(app, supports_credentials=True)
Compress(app)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# ══════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════
CONFIG = {
    'IMAGE_SIZE': (256, 192),
    'JPEG_QUALITY': 50,
    'MIN_DETECTION_CONFIDENCE': 0.5,
    'MIN_TRACKING_CONFIDENCE': 0.3,
    'MODEL_COMPLEXITY': 0,
    'SMOOTH_LANDMARKS': True,
    'REFERENCE_FILE': 'pose_reference.json',
    'PERFECT_THRESHOLD': 80,
    'GOOD_THRESHOLD': 65,
    'USER_DATA_DIR': 'user_data',
    'TEMP_UPLOAD_DIR': 'temp_uploads',
    'YOGA_DIR': 'yoga',
}

# ══════════════════════════════════════════════════════
# User Store
# ══════════════════════════════════════════════════════
USER_STORE = 'users.json'

def load_users():
    if os.path.exists(USER_STORE):
        with open(USER_STORE, 'r') as f:
            return json.load(f)
    return {}

def save_users(users):
    with open(USER_STORE, 'w') as f:
        json.dump(users, f, indent=2)

# ══════════════════════════════════════════════════════
# MediaPipe Setup
# ══════════════════════════════════════════════════════
mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils

pose_live = mp_pose.Pose(
    static_image_mode=False,
    model_complexity=CONFIG['MODEL_COMPLEXITY'],
    min_detection_confidence=CONFIG['MIN_DETECTION_CONFIDENCE'],
    min_tracking_confidence=CONFIG['MIN_TRACKING_CONFIDENCE'],
    enable_segmentation=False,
    smooth_landmarks=CONFIG['SMOOTH_LANDMARKS'],
    smooth_segmentation=False
)

# ══════════════════════════════════════════════════════
# Helper Classes
# ══════════════════════════════════════════════════════

class ImageProcessor:
    """Handle image processing and validation."""
    
    ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
    MAX_FILE_SIZE = 10 * 1024 * 1024
    REQUIRED_IMAGES = 5
    
    def __init__(self, upload_dir: str = "temp_uploads"):
        self.upload_dir = upload_dir
        os.makedirs(upload_dir, exist_ok=True)
    
    def save_temp_image(self, file_data: bytes, original_filename: str) -> Optional[str]:
        logger.info(f"📥 Saving temp image: {original_filename}")
        try:
            ext = os.path.splitext(original_filename)[1].lower().lstrip('.')
            if ext not in self.ALLOWED_EXTENSIONS:
                ext = 'jpg'
                logger.info(f"📄 Extension changed to {ext}")
            
            filename = f"{uuid.uuid4()}.{ext}"
            file_path = os.path.join(self.upload_dir, filename)
            
            with open(file_path, 'wb') as f:
                f.write(file_data)
            logger.info(f"💾 File written to {file_path} ({len(file_data)} bytes)")
            
            # Validate image
            try:
                import PIL.Image
                img = PIL.Image.open(file_path)
                img.verify()
                logger.info(f"✅ Image validation passed")
                return file_path
            except Exception as e:
                os.remove(file_path)
                logger.error(f"❌ Image validation failed: {e}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Error saving temp image: {e}")
            return None
    
    def delete_temp_file(self, file_path: str) -> bool:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"🗑️ Deleted temp file: {file_path}")
                return True
        except Exception as e:
            logger.error(f"Error deleting temp file: {e}")
        return False
    
    def cleanup_temp_dir(self):
        import time
        now = time.time()
        for f in os.listdir(self.upload_dir):
            file_path = os.path.join(self.upload_dir, f)
            if os.path.isfile(file_path):
                if now - os.path.getmtime(file_path) > 3600:
                    try:
                        os.remove(file_path)
                        logger.info(f"🧹 Cleaned up old temp file: {f}")
                    except:
                        pass


class CustomPoseManager:
    """Manage user-specific custom poses."""
    
    def __init__(self, base_dir: str = "user_data"):
        self.base_dir = base_dir
        os.makedirs(self.base_dir, exist_ok=True)
    
    def get_user_dir(self, user_id: str) -> str:
        return os.path.join(self.base_dir, user_id)
    
    def get_custom_poses_path(self, user_id: str) -> str:
        return os.path.join(self.get_user_dir(user_id), "custom_poses.json")
    
    def get_upload_dir(self, user_id: str, pose_id: str) -> str:
        path = os.path.join(self.get_user_dir(user_id), "images", pose_id)
        os.makedirs(path, exist_ok=True)
        return path
    
    def load_custom_poses(self, user_id: str) -> Dict:
        path = self.get_custom_poses_path(user_id)
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    data = json.load(f)
                    logger.info(f"📂 Loaded {len(data)} custom poses for user {user_id[:8]}")
                    return data
            except Exception as e:
                logger.error(f"Error loading custom poses: {e}")
        return {}
    
    def save_custom_poses(self, user_id: str, poses: Dict) -> bool:
        path = self.get_custom_poses_path(user_id)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w') as f:
                json.dump(poses, f, indent=2)
            logger.info(f"💾 Saved {len(poses)} custom poses for user {user_id[:8]}")
            return True
        except Exception as e:
            logger.error(f"Error saving custom poses: {e}")
            return False
    
    def add_custom_pose(self, user_id: str, pose_id: str, reference: Dict, images: List[str]) -> bool:
        logger.info(f"📂 Adding custom pose {pose_id} for user {user_id[:8]}")
        poses = self.load_custom_poses(user_id)
        
        if pose_id in poses:
            logger.warning(f"⚠️ Pose {pose_id} already exists, overwriting")
        
        poses[pose_id] = reference
        logger.info(f"📝 Reference data for {pose_id}: angles={len(reference.get('angles', []))} joints")
        
        if images:
            upload_dir = self.get_upload_dir(user_id, pose_id)
            logger.info(f"📁 Saving {len(images)} images to {upload_dir}")
            for i, img_path in enumerate(images):
                if os.path.exists(img_path):
                    dest = os.path.join(upload_dir, f"reference_{i+1}.jpg")
                    shutil.copy2(img_path, dest)
                    logger.info(f"✅ Copied {img_path} -> {dest}")
                else:
                    logger.warning(f"⚠️ Image {img_path} not found, skipping")
        else:
            logger.info("ℹ️ No images to copy (they are deleted after processing)")
        
        success = self.save_custom_poses(user_id, poses)
        if success:
            logger.info(f"✅ Custom poses saved (total: {len(poses)})")
        else:
            logger.error("❌ Failed to save custom poses")
        return success
    
    def get_custom_pose_images(self, user_id: str, pose_id: str) -> List[str]:
        upload_dir = self.get_upload_dir(user_id, pose_id)
        if not os.path.exists(upload_dir):
            return []
        
        images = []
        for f in sorted(os.listdir(upload_dir)):
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                images.append(os.path.join(upload_dir, f))
        return images


class PoseGenerator:
    """Generate pose references from images."""
    
    def __init__(self):
        self.pose = mp_pose.Pose(
            static_image_mode=True,
            model_complexity=0,
            min_detection_confidence=0.5,
        )
        self.joint_pairs = [
            (11, 13, 15), (12, 14, 16), (11, 23, 25), (12, 24, 26),
            (23, 25, 27), (24, 26, 28), (11, 23, 24), (12, 24, 23),
            (11, 0, 12), (13, 11, 23), (14, 12, 24), (15, 13, 11),
            (16, 14, 12), (25, 23, 24), (26, 24, 23),
        ]
        self.default_weights = [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 
                                0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8]
    
    def _calculate_angle(self, a, b, c):
        a, b, c = np.array(a), np.array(b), np.array(c)
        radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
        angle = np.abs(radians * 180.0 / np.pi)
        if angle > 180:
            angle = 360 - angle
        return angle
    
    def extract_landmarks(self, image_path: str) -> Optional[Dict]:
        logger.info(f"🔍 Extracting landmarks from {image_path}")
        try:
            img = cv2.imread(image_path)
            if img is None:
                logger.error(f"❌ Could not read image: {image_path}")
                return None
            
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = self.pose.process(rgb)
            
            if not results.pose_landmarks:
                logger.warning(f"⚠️ No pose detected in {image_path}")
                return None
            
            landmarks = [[lm.x, lm.y] for lm in results.pose_landmarks.landmark]
            logger.info(f"✅ Detected {len(landmarks)} landmarks")
            
            angles = []
            for a, b, c in self.joint_pairs:
                if a >= len(landmarks) or b >= len(landmarks) or c >= len(landmarks):
                    logger.warning(f"⚠️ Landmark index out of range for {a},{b},{c}")
                    return None
                angles.append(self._calculate_angle(landmarks[a], landmarks[b], landmarks[c]))
            
            logger.info(f"✅ Extracted {len(angles)} angles")
            return {
                'landmarks': landmarks,
                'angles': angles,
                'confidence': results.pose_landmarks.landmark[0].visibility
            }
            
        except Exception as e:
            logger.error(f"❌ Error extracting landmarks: {e}")
            return None
    
    def calculate_tolerances(self, angle_lists: List[List[float]]) -> List[float]:
        angle_array = np.array(angle_lists)
        std_devs = np.std(angle_array, axis=0)
        return [max(5, min(25, std * 2)) for std in std_devs]
    
    def compare_similarity(self, landmarks_list: List[List[List[float]]]) -> float:
        if len(landmarks_list) < 2:
            return 1.0
        
        arrays = [np.array(lm) for lm in landmarks_list]
        similarities = []
        
        for i in range(len(arrays)):
            for j in range(i + 1, len(arrays)):
                if arrays[i].shape != arrays[j].shape:
                    continue
                diff = np.mean((arrays[i] - arrays[j]) ** 2)
                sim = max(0, 1 - (diff * 5))
                similarities.append(sim)
        
        return float(np.mean(similarities)) if similarities else 0.0
    
    def generate_pose_reference(self, image_paths: List[str], pose_name: str,
                                difficulty: str = "Beginner", category: str = "General") -> Optional[Dict]:
        logger.info(f"🔄 Generating reference for '{pose_name}' with {len(image_paths)} images")
        if len(image_paths) != 5:
            return {'error': f'Expected 5 images, got {len(image_paths)}'}
        
        landmarks_list = []
        angle_lists = []
        
        for i, path in enumerate(image_paths):
            data = self.extract_landmarks(path)
            if data is None:
                return {'error': f'Failed to extract pose from image {i+1}'}
            landmarks_list.append(data['landmarks'])
            angle_lists.append(data['angles'])
        
        similarity = self.compare_similarity(landmarks_list)
        if similarity < 0.5:
            return {'error': f'Images show different poses (similarity: {similarity:.2f})'}
        
        angle_array = np.array(angle_lists)
        avg_angles = np.mean(angle_array, axis=0).tolist()
        tolerances = self.calculate_tolerances(angle_lists)
        
        pose_id = pose_name.lower().replace(' ', '-').replace("'", "").replace('(', '').replace(')', '')
        logger.info(f"📝 Average angles: {len(avg_angles)} angles, tolerances: {len(tolerances)}")
        
        reference = {
            'name': pose_name,
            'difficulty': difficulty,
            'category': category,
            'angles': avg_angles,
            'tolerances': tolerances,
            'weights': self.default_weights,
            'sample_count': len(image_paths),
            'generated_at': datetime.now().isoformat(),
            'similarity_score': similarity,
            'is_custom': True
        }
        
        return {
            'pose_id': pose_id,
            'reference': reference,
            'similarity': similarity,
            'avg_angles': avg_angles,
            'sample_count': len(image_paths)
        }
    
    def cleanup(self):
        if hasattr(self, 'pose'):
            self.pose.close()


class PoseReferenceLoader:
    """Load built-in poses from pose_reference.json."""
    
    def __init__(self, reference_file=CONFIG['REFERENCE_FILE']):
        self.reference_file = reference_file
        self.pose_database = {}
        self._load_reference()
    
    def _load_reference(self):
        if not os.path.exists(self.reference_file):
            logger.warning(f"Reference file {self.reference_file} not found!")
            self._generate_fallback()
            return
        
        try:
            with open(self.reference_file, 'r') as f:
                raw_data = json.load(f)
            
            self.pose_database = {}
            for key, data in raw_data.items():
                normalized_id = key.lower().replace(' ', '-').replace("'", "").replace('(', '').replace(')', '')
                if normalized_id in self.pose_database:
                    continue
                data['name'] = key
                self.pose_database[normalized_id] = data
            
            logger.info(f"✅ Loaded {len(self.pose_database)} built-in poses")
        except Exception as e:
            logger.error(f"Error loading {self.reference_file}: {e}")
            self._generate_fallback()
    
    def _generate_fallback(self):
        fallback_data = {
            'downward-dog': {
                'name': 'Downward Facing Dog',
                'difficulty': 'Beginner',
                'category': 'Standing',
                'angles': [150, 170, 90, 90, 160, 160, 100, 100, 150, 120, 120, 160, 160, 90, 90],
                'tolerances': [15, 15, 12, 12, 20, 20, 10, 10, 8, 12, 12, 15, 15, 15, 15],
                'weights': [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8],
            },
            'warrior-2': {
                'name': 'Warrior II',
                'angles': [170, 170, 90, 90, 90, 170, 100, 100, 160, 80, 80, 170, 170, 90, 90],
                'tolerances': [15, 15, 12, 12, 20, 20, 10, 10, 8, 12, 12, 15, 15, 15, 15],
                'weights': [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8],
            },
            'tree': {
                'name': 'Tree Pose',
                'angles': [170, 170, 170, 170, 170, 170, 100, 100, 160, 170, 170, 170, 170, 90, 90],
                'tolerances': [15, 15, 12, 12, 20, 20, 10, 10, 8, 12, 12, 15, 15, 15, 15],
                'weights': [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8],
            },
            'cobra': {
                'name': 'Cobra Pose',
                'angles': [150, 150, 100, 100, 170, 170, 130, 130, 120, 90, 90, 150, 150, 100, 100],
                'tolerances': [15, 15, 12, 12, 20, 20, 10, 10, 8, 12, 12, 15, 15, 15, 15],
                'weights': [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8],
            },
            'mountain': {
                'name': 'Mountain Pose',
                'angles': [180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180],
                'tolerances': [15, 15, 12, 12, 20, 20, 10, 10, 8, 12, 12, 15, 15, 15, 15],
                'weights': [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8],
            },
            'childs-pose': {
                'name': "Child's Pose",
                'angles': [140, 140, 50, 50, 90, 90, 130, 130, 90, 60, 60, 140, 140, 50, 50],
                'tolerances': [15, 15, 12, 12, 20, 20, 10, 10, 8, 12, 12, 15, 15, 15, 15],
                'weights': [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8],
            },
            'bridge': {
                'name': 'Bridge Pose',
                'angles': [150, 150, 150, 150, 90, 90, 150, 150, 120, 100, 100, 150, 150, 90, 90],
                'tolerances': [15, 15, 12, 12, 20, 20, 10, 10, 8, 12, 12, 15, 15, 15, 15],
                'weights': [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8],
            },
        }
        self.pose_database = fallback_data
        logger.info(f"Loaded {len(self.pose_database)} fallback poses")
    
    def get_all_poses(self) -> List[Dict]:
        result = []
        for pose_id, data in self.pose_database.items():
            result.append({
                'id': pose_id,
                'name': data.get('name', pose_id),
                'english': data.get('name', pose_id),
                'difficulty': data.get('difficulty', 'Beginner'),
                'category': data.get('category', 'General'),
                'sample_count': data.get('sample_count', 0),
                'is_custom': False,
            })
        return sorted(result, key=lambda x: x['name'])
    
    def get_pose(self, pose_id: str) -> Optional[Dict]:
        return self.pose_database.get(pose_id)
    
    def merge_with_custom(self, custom_poses: Dict) -> Dict:
        merged = self.pose_database.copy()
        for pose_id, data in custom_poses.items():
            if pose_id not in merged:
                merged[pose_id] = data
        return merged


class PoseComparisonEngine:
    """Compare live pose with reference."""
    
    def __init__(self):
        self.joint_pairs = [
            (11, 13, 15), (12, 14, 16), (11, 23, 25), (12, 24, 26),
            (23, 25, 27), (24, 26, 28), (11, 23, 24), (12, 24, 23),
            (11, 0, 12), (13, 11, 23), (14, 12, 24), (15, 13, 11),
            (16, 14, 12), (25, 23, 24), (26, 24, 23),
        ]
    
    def _calculate_angle(self, a, b, c):
        a, b, c = np.array(a), np.array(b), np.array(c)
        radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
        angle = np.abs(radians * 180.0 / np.pi)
        if angle > 180:
            angle = 360 - angle
        return angle
    
    def extract_angles(self, landmarks):
        angles = []
        try:
            for a, b, c in self.joint_pairs:
                if a >= len(landmarks) or b >= len(landmarks) or c >= len(landmarks):
                    continue
                angles.append(self._calculate_angle(landmarks[a], landmarks[b], landmarks[c]))
        except (IndexError, ValueError):
            return None
        return np.array(angles) if angles else None
    
    def compare(self, current_angles, pose_id, merged_database=None) -> Tuple[float, List[str]]:
        if merged_database is None:
            return 0, []
        
        reference_data = merged_database.get(pose_id)
        if reference_data is None:
            return 0, []
        
        reference_angles = reference_data.get('angles', [])
        tolerances = reference_data.get('tolerances', [])
        weights = reference_data.get('weights', [])
        
        if len(current_angles) == 0 or len(reference_angles) == 0:
            return 0, []
        
        min_len = min(len(current_angles), len(reference_angles))
        current = current_angles[:min_len]
        reference = reference_angles[:min_len]
        tolerances = tolerances[:min_len] if tolerances else [15] * min_len
        weights = weights[:min_len] if weights else [1.0] * min_len
        
        differences = np.abs(current - reference)
        
        joint_scores = []
        joint_feedback = []
        
        for i, diff in enumerate(differences):
            tolerance = tolerances[i] if i < len(tolerances) else 15
            weight = weights[i] if i < len(weights) else 1.0
            
            if diff <= tolerance:
                joint_score = 100
            else:
                excess = diff - tolerance
                joint_score = max(0, 100 - (excess / 30) * 100)
            
            joint_scores.append(joint_score * weight)
            
            if diff > tolerance:
                joint_feedback.append(f"Adjust joint {i+1}")
        
        total_weight = sum(weights)
        if total_weight > 0:
            overall_score = sum(joint_scores) / total_weight
        else:
            overall_score = np.mean(joint_scores) if joint_scores else 0
        
        # Cosine similarity
        if np.linalg.norm(current) > 0 and np.linalg.norm(reference) > 0:
            dot_product = np.dot(current, reference)
            norm_current = np.linalg.norm(current)
            norm_reference = np.linalg.norm(reference)
            cosine_sim = dot_product / (norm_current * norm_reference + 1e-8)
            similarity_score = max(0, min(100, cosine_sim * 100))
        else:
            similarity_score = 0
        
        final_score = 0.7 * overall_score + 0.3 * similarity_score
        return max(0, min(100, final_score)), joint_feedback[:4]
    
    def get_status(self, score):
        if score >= CONFIG['PERFECT_THRESHOLD']:
            return '🌟 Excellent'
        elif score >= CONFIG['GOOD_THRESHOLD']:
            return '👍 Good – small adjustments'
        elif score >= 45:
            return '💪 Getting there – keep adjusting'
        else:
            return '🔄 Needs significant correction'


# ══════════════════════════════════════════════════════
# Initialize Components
# ══════════════════════════════════════════════════════
image_processor = ImageProcessor(CONFIG['TEMP_UPLOAD_DIR'])
custom_pose_manager = CustomPoseManager(CONFIG['USER_DATA_DIR'])
pose_generator = PoseGenerator()
reference_loader = PoseReferenceLoader(CONFIG['REFERENCE_FILE'])
comparison_engine = PoseComparisonEngine()

# Global cache for reference images
pose_reference_images = {}


def get_user_id() -> str:
    """
    Get user ID from session (preferred) or from X-User-ID header (fallback).
    """
    # 1. Check session (primary)
    if 'user_id' in session:
        return session['user_id']
    # 2. Check header (for API clients)
    user_id = request.headers.get('X-User-ID')
    if user_id:
        # Ensure user directory exists
        user_dir = os.path.join(CONFIG['USER_DATA_DIR'], user_id)
        if not os.path.exists(user_dir):
            os.makedirs(user_dir, exist_ok=True)
        return user_id
    # 3. Fallback – should not happen after login
    return 'anonymous'


def get_all_poses() -> List[Dict]:
    """Get all poses (built-in + custom) for the current user."""
    user_id = get_user_id()
    all_poses = reference_loader.get_all_poses()
    
    # Load custom poses
    custom_poses = custom_pose_manager.load_custom_poses(user_id)
    for pose_id, data in custom_poses.items():
        all_poses.append({
            'id': pose_id,
            'name': data.get('name', pose_id),
            'english': data.get('name', pose_id),
            'difficulty': data.get('difficulty', 'Beginner'),
            'category': data.get('category', 'General'),
            'sample_count': data.get('sample_count', 0),
            'is_custom': True,
            'generated_at': data.get('generated_at', None),
            'similarity_score': data.get('similarity_score', None),
        })
    
    # Add emojis and default fields
    emoji_map = {
        'downward-dog': '🐕', 'warrior-2': '⚔️', 'tree': '🌳',
        'cobra': '🐍', 'mountain': '🏔️', 'childs-pose': '🙏',
        'bridge': '🌉', 'plank': '📐', 'boat': '⛵',
        'lotus': '🪷', 'crow': '🦅', 'dancer': '💃',
    }
    for pose in all_poses:
        pose['emoji'] = emoji_map.get(pose['id'], '🧘')
        if not pose.get('benefits'):
            pose['benefits'] = ['Practice this pose', 'Improve alignment', 'Build strength']
        if not pose.get('steps'):
            pose['steps'] = ['Position yourself in the pose', 'Hold the posture', 'Breathe deeply']
        if not pose.get('difficulty'):
            pose['difficulty'] = 'Beginner'
    
    return sorted(all_poses, key=lambda x: x['name'])


def get_merged_poses() -> Dict:
    """Get merged database for comparison."""
    user_id = get_user_id()
    custom_poses = custom_pose_manager.load_custom_poses(user_id)
    return reference_loader.merge_with_custom(custom_poses)


# ══════════════════════════════════════════════════════
# Authentication Routes
# ══════════════════════════════════════════════════════

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    name = data.get('name', '').strip()
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    users = load_users()
    if email in users:
        return jsonify({'error': 'Email already registered'}), 400
    user_id = email.replace('@', '_').replace('.', '_')
    users[email] = {
        'user_id': user_id,
        'name': name or email.split('@')[0],
        'password_hash': generate_password_hash(password)
    }
    save_users(users)
    session['user_id'] = user_id
    return jsonify({'user_id': user_id, 'name': users[email]['name']})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    users = load_users()
    if email not in users:
        return jsonify({'error': 'Invalid credentials'}), 401
    if not check_password_hash(users[email]['password_hash'], password):
        return jsonify({'error': 'Invalid credentials'}), 401
    session['user_id'] = users[email]['user_id']
    return jsonify({'user_id': users[email]['user_id'], 'name': users[email]['name']})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    return jsonify({'success': True})

@app.route('/api/me', methods=['GET'])
def me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Not logged in'}), 401
    users = load_users()
    for email, data in users.items():
        if data['user_id'] == user_id:
            return jsonify({'user_id': user_id, 'name': data['name']})
    return jsonify({'error': 'User not found'}), 404

# ══════════════════════════════════════════════════════
# Existing API Routes (unchanged)
# ══════════════════════════════════════════════════════

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/poses', methods=['GET'])
def get_poses():
    try:
        poses = get_all_poses()
        logger.info(f"📤 Returning {len(poses)} poses")
        return jsonify(poses)
    except Exception as e:
        logger.error(f"Error getting poses: {e}")
        return jsonify([])


@app.route('/api/pose/<pose_id>/references', methods=['GET'])
def get_pose_references(pose_id):
    user_id = get_user_id()
    images = []
    
    # Built-in images
    builtin_folder = os.path.join(CONFIG['YOGA_DIR'], pose_id)
    if os.path.exists(builtin_folder):
        for f in os.listdir(builtin_folder):
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                try:
                    with open(os.path.join(builtin_folder, f), 'rb') as img_f:
                        img_data = base64.b64encode(img_f.read()).decode('utf-8')
                        mime = 'image/jpeg' if f.endswith(('.jpg', '.jpeg')) else 'image/png'
                        images.append({'id': len(images), 'filename': f, 'data': img_data, 'mime': mime})
                except Exception as e:
                    logger.error(f"Error loading reference image {f}: {e}")
    
    # Custom images
    custom_images = custom_pose_manager.get_custom_pose_images(user_id, pose_id)
    for img_path in custom_images:
        try:
            with open(img_path, 'rb') as f:
                img_data = base64.b64encode(f.read()).decode('utf-8')
                images.append({'id': len(images), 'filename': os.path.basename(img_path), 'data': img_data, 'mime': 'image/jpeg'})
        except Exception as e:
            logger.error(f"Error loading custom reference image: {e}")
    
    return jsonify({'references': images, 'count': len(images)})


@app.route('/api/live', methods=['POST'])
def api_live():
    start_time = time.time()
    try:
        data = request.get_json(silent=True)
        if not data or 'image' not in data or 'pose_id' not in data:
            return jsonify({'error': 'Missing image or pose_id'}), 400
        
        pose_id = data['pose_id']
        image_b64 = data['image']
        if ',' in image_b64:
            image_b64 = image_b64.split(',', 1)[1]
        
        try:
            img_bytes = base64.b64decode(image_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            logger.error(f"Image decode error: {e}")
            return jsonify({'error': 'Invalid image data'}), 400
        
        if img is None:
            return jsonify({'error': 'Could not decode image'}), 400
        
        img = cv2.resize(img, CONFIG['IMAGE_SIZE'])
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        results = pose_live.process(rgb)
        
        response_data = {
            'score': 0,
            'status': 'No person detected',
            'suggestions': [
                'Make sure your full body is visible',
                'Stand back so camera captures head to feet',
                'Ensure good lighting',
                'Wear contrasting clothing'
            ],
            'pose_name': 'Unknown',
            'processing_time': 0,
            'landmarks': []
        }
        
        if results.pose_landmarks:
            landmarks_data = [[lm.x, lm.y] for lm in results.pose_landmarks.landmark]
            landmarks = np.array(landmarks_data)
            
            merged_db = get_merged_poses()
            
            if pose_id not in merged_db:
                response_data['suggestions'] = [f'Pose "{pose_id}" not found', 'Try using Add Pose']
                response_data['landmarks'] = landmarks_data
            else:
                current_angles = comparison_engine.extract_angles(landmarks)
                if current_angles is not None and len(current_angles) > 0:
                    score, joint_feedback = comparison_engine.compare(current_angles, pose_id, merged_db)
                    score = int(round(score))
                    status = comparison_engine.get_status(score)
                    
                    if score >= CONFIG['PERFECT_THRESHOLD']:
                        suggestions = ['🌟 Excellent! Perfect form!']
                        suggestions.extend(joint_feedback[:2] if joint_feedback else ['Focus on deep breathing'])
                    elif score >= CONFIG['GOOD_THRESHOLD']:
                        suggestions = ['👍 Good! Almost perfect!']
                        suggestions.extend(joint_feedback[:3])
                    else:
                        suggestions = ['🔄 Focus on these corrections:']
                        suggestions.extend(joint_feedback[:4])
                        if len(joint_feedback) < 2:
                            suggestions.append('Practice the basic pose first')
                    
                    color = (34, 197, 94) if score >= 80 else (245, 158, 11) if score >= 65 else (239, 68, 68)
                    drawing_spec = mp_drawing.DrawingSpec(color=color, thickness=2, circle_radius=3)
                    mp_drawing.draw_landmarks(img, results.pose_landmarks, mp_pose.POSE_CONNECTIONS, drawing_spec, drawing_spec)
                    
                    response_data = {
                        'score': score,
                        'status': status,
                        'suggestions': suggestions[:5],
                        'pose_name': pose_id,
                        'database_used': True,
                        'landmarks': landmarks_data
                    }
                else:
                    response_data['suggestions'] = ['Could not extract pose features']
                    response_data['landmarks'] = landmarks_data
        else:
            response_data['suggestions'] = [
                '👤 No person detected',
                'Make sure your full body is visible',
                'Stand back so camera captures head to feet',
                'Ensure good lighting'
            ]
        
        _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, CONFIG['JPEG_QUALITY']])
        response_data['image'] = base64.b64encode(buffer).decode('utf-8')
        response_data['processing_time'] = int((time.time() - start_time) * 1000)
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"API Live error: {e}", exc_info=True)
        return jsonify({'error': str(e), 'score': 0, 'status': 'Error', 'suggestions': ['An error occurred'], 'landmarks': []}), 500


@app.route('/api/generate-pose', methods=['POST'])
def generate_pose():
    logger.info("🔄 Generating pose from uploaded images...")
    try:
        name = request.form.get('name', '').strip()
        if not name:
            return jsonify({'error': 'Pose name is required'}), 400
        
        category = request.form.get('category', 'General')
        difficulty = request.form.get('difficulty', 'Beginner')
        
        image_paths = []
        for i in range(5):
            file_key = f'image_{i}'
            if file_key not in request.files:
                logger.error(f"Missing image {i+1}")
                return jsonify({'error': f'Missing image {i+1}'}), 400
            
            file = request.files[file_key]
            if file.filename == '':
                logger.error(f"Empty file for image {i+1}")
                return jsonify({'error': f'Empty file for image {i+1}'}), 400
            
            logger.info(f"📥 Received image {i+1}: {file.filename}")
            temp_path = image_processor.save_temp_image(file.read(), file.filename)
            if not temp_path:
                logger.error(f"Failed to save image {i+1}")
                return jsonify({'error': f'Failed to save image {i+1}'}), 400
            
            image_paths.append(temp_path)
            logger.info(f"✅ Saved to: {temp_path}")
        
        result = pose_generator.generate_pose_reference(
            image_paths=image_paths,
            pose_name=name,
            difficulty=difficulty,
            category=category
        )
        
        for path in image_paths:
            image_processor.delete_temp_file(path)
        
        if result is None:
            logger.error("Generation result is None")
            return jsonify({'error': 'Failed to generate pose'}), 400
        
        if 'error' in result:
            logger.error(f"Generation error: {result['error']}")
            return jsonify({'error': result['error']}), 400
        
        result['pose_name'] = name
        result['category'] = category
        result['difficulty'] = difficulty
        
        logger.info(f"✅ Pose generated successfully: {name}")
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error generating pose: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/save-custom-pose', methods=['POST'])
def save_custom_pose():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        pose_id = data.get('pose_id')
        reference = data.get('reference')
        name = data.get('name', pose_id)
        
        if not pose_id or not reference:
            return jsonify({'error': 'Missing pose_id or reference'}), 400
        
        if 'angles' not in reference:
            return jsonify({'error': 'Invalid reference: missing "angles"'}), 400
        
        user_id = get_user_id()
        logger.info(f"💾 Saving custom pose '{name}' (ID: {pose_id}) for user {user_id[:8]}")
        
        success = custom_pose_manager.add_custom_pose(
            user_id=user_id,
            pose_id=pose_id,
            reference=reference,
            images=[]
        )
        
        if not success:
            logger.error("Failed to save custom pose")
            return jsonify({'error': 'Failed to save pose'}), 500
        
        # Invalidate cache
        global pose_reference_images
        cache_key = f"{user_id}_{pose_id}"
        if cache_key in pose_reference_images:
            del pose_reference_images[cache_key]
            logger.info(f"🗑️ Invalidated cache for {cache_key}")
        
        logger.info(f"✅ Pose '{name}' saved successfully")
        return jsonify({
            'success': True,
            'message': f'Pose "{name}" saved successfully',
            'pose_id': pose_id
        })
            
    except Exception as e:
        logger.error(f"Error saving custom pose: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/custom-poses', methods=['GET'])
def get_custom_poses():
    user_id = get_user_id()
    poses = custom_pose_manager.load_custom_poses(user_id)
    return jsonify(poses)


@app.route('/api/health', methods=['GET'])
def health_check():
    user_id = get_user_id()
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'builtin_poses': len(reference_loader.pose_database),
        'custom_poses': len(custom_pose_manager.load_custom_poses(user_id)),
    })


# ══════════════════════════════════════════════════════
# Main Entry Point
# ══════════════════════════════════════════════════════
if __name__ == '__main__':
    logger.info("=" * 60)
    logger.info("🧘 YogaMate Server Starting...")
    logger.info(f"📊 Built-in poses: {len(reference_loader.pose_database)}")
    logger.info("=" * 60)
    
    # Cleanup temp directory
    image_processor.cleanup_temp_dir()
    
    app.run(
        host='0.0.0.0',
        port=7860,
        debug=False,
        threaded=True,
        use_reloader=False
    )