"""
Pose Generator Module
Extracts and processes pose data from images to generate reference poses
"""

import os
import json
import logging
import numpy as np
import cv2
import mediapipe as mp
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import uuid

logger = logging.getLogger(__name__)

mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils

class PoseGenerator:
    """Generate pose references from uploaded images."""
    
    def __init__(self):
        self.pose = mp_pose.Pose(
            static_image_mode=True,
            model_complexity=0,
            min_detection_confidence=0.5,
            enable_segmentation=False,
        )
        self.joint_pairs = [
            (11, 13, 15), (12, 14, 16), (11, 23, 25), (12, 24, 26),
            (23, 25, 27), (24, 26, 28), (11, 23, 24), (12, 24, 23),
            (11, 0, 12), (13, 11, 23), (14, 12, 24), (15, 13, 11),
            (16, 14, 12), (25, 23, 24), (26, 24, 23),
        ]
        self.default_weights = [1.0, 1.0, 1.2, 1.2, 1.0, 1.0, 0.8, 0.8, 
                                0.8, 1.0, 1.0, 0.7, 0.7, 0.8, 0.8]
    
    def extract_angles(self, landmarks: np.ndarray) -> Optional[np.ndarray]:
        def calculate_angle(a, b, c):
            a = np.array(a)
            b = np.array(b)
            c = np.array(c)
            radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
            angle = np.abs(radians * 180.0 / np.pi)
            if angle > 180:
                angle = 360 - angle
            return angle
        
        angles = []
        try:
            for a, b, c in self.joint_pairs:
                if a >= len(landmarks) or b >= len(landmarks) or c >= len(landmarks):
                    return None
                angles.append(calculate_angle(landmarks[a], landmarks[b], landmarks[c]))
        except (IndexError, ValueError):
            return None
        return np.array(angles)
    
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
            
            landmarks = []
            for lm in results.pose_landmarks.landmark:
                landmarks.append([lm.x, lm.y])
            
            landmarks_np = np.array(landmarks)
            logger.info(f"✅ Detected {len(landmarks_np)} landmarks")
            
            angles = self.extract_angles(landmarks_np)
            if angles is None:
                logger.warning(f"⚠️ Failed to extract angles from {image_path}")
                return None
            
            logger.info(f"✅ Extracted {len(angles)} angles")
            return {
                'landmarks': landmarks_np.tolist(),
                'angles': angles.tolist(),
                'detection_confidence': results.pose_landmarks.landmark[0].visibility
            }
            
        except Exception as e:
            logger.error(f"❌ Error processing image {image_path}: {e}")
            return None
    
    def calculate_tolerances(self, angle_lists: List[List[float]]) -> List[float]:
        angle_array = np.array(angle_lists)
        std_devs = np.std(angle_array, axis=0)
        tolerances = []
        for std in std_devs:
            tol = max(5, min(25, std * 2))
            tolerances.append(float(tol))
        return tolerances
    
    def compare_landmark_similarity(self, landmarks_list: List[List[List[float]]]) -> float:
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
    
    def generate_pose_reference(
        self,
        image_paths: List[str],
        pose_name: str,
        difficulty: str = "Beginner",
        category: str = "General"
    ) -> Optional[Dict]:
        logger.info(f"🔄 Generating reference for '{pose_name}' with {len(image_paths)} images")
        if len(image_paths) != 5:
            logger.error(f"Expected 5 images, got {len(image_paths)}")
            return None
        
        extracted_data = []
        landmarks_list = []
        angle_lists = []
        
        for i, path in enumerate(image_paths):
            data = self.extract_landmarks(path)
            if data is None:
                logger.error(f"Failed to extract landmarks from {path}")
                return {'error': f'Failed to extract pose from image {i+1}'}
            
            extracted_data.append(data)
            landmarks_list.append(data['landmarks'])
            angle_lists.append(data['angles'])
        
        similarity = self.compare_landmark_similarity(landmarks_list)
        if similarity < 0.5:
            logger.warning(f"Pose similarity too low: {similarity:.2f}")
            return {
                'error': f'The uploaded images show different poses (similarity: {similarity:.2f}). Please upload 5 similar images of the same pose.',
                'similarity': similarity
            }
        
        angle_array = np.array(angle_lists)
        avg_angles = np.mean(angle_array, axis=0).tolist()
        tolerances = self.calculate_tolerances(angle_lists)
        weights = self.default_weights.copy()
        
        if len(avg_angles) != 15:
            logger.error(f"Expected 15 angles, got {len(avg_angles)}")
            return None
        
        pose_id = pose_name.lower().replace(' ', '-').replace("'", "").replace('(', '').replace(')', '')
        logger.info(f"📝 Average angles: {len(avg_angles)} angles, tolerances: {len(tolerances)}")
        
        reference = {
            'name': pose_name,
            'difficulty': difficulty,
            'category': category,
            'angles': avg_angles,
            'tolerances': tolerances,
            'weights': weights,
            'sample_count': len(image_paths),
            'generated_at': datetime.now().isoformat(),
            'similarity_score': similarity,
            'landmark_samples': landmarks_list,
        }
        
        return {
            'pose_id': pose_id,
            'reference': reference,
            'similarity': similarity,
            'avg_angles': avg_angles,
            'tolerances': tolerances,
            'sample_count': len(image_paths)
        }

    def cleanup(self):
        if hasattr(self, 'pose'):
            self.pose.close()
            