"""
Custom Pose Manager
Handles loading, saving, and merging custom poses per user
"""

import os
import json
import logging
import shutil
from typing import Dict, List, Optional
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)

class CustomPoseManager:
    """Manage user-specific custom pose databases."""
    
    def __init__(self, base_dir: str = "user_data"):
        self.base_dir = base_dir
        self.custom_poses = {}
        self.user_id = None
        
        os.makedirs(self.base_dir, exist_ok=True)
    
    def get_user_id(self) -> str:
        if self.user_id:
            return self.user_id
        
        user_file = os.path.join(self.base_dir, ".user_id")
        if os.path.exists(user_file):
            try:
                with open(user_file, 'r') as f:
                    uid = f.read().strip()
                    if uid and os.path.exists(self.get_user_dir(uid)):
                        self.user_id = uid
                        self.load_custom_poses()
                        return uid
            except:
                pass
        
        self.user_id = str(uuid.uuid4())
        os.makedirs(self.get_user_dir(), exist_ok=True)
        
        with open(user_file, 'w') as f:
            f.write(self.user_id)
        
        return self.user_id
    
    def get_user_dir(self, user_id: Optional[str] = None) -> str:
        uid = user_id or self.user_id or self.get_user_id()
        return os.path.join(self.base_dir, uid)
    
    def get_custom_poses_path(self, user_id: Optional[str] = None) -> str:
        return os.path.join(self.get_user_dir(user_id), "custom_poses.json")
    
    def get_upload_dir(self, pose_id: str, user_id: Optional[str] = None) -> str:
        upload_dir = os.path.join(self.get_user_dir(user_id), "images", pose_id)
        os.makedirs(upload_dir, exist_ok=True)
        return upload_dir
    
    def load_custom_poses(self, user_id: Optional[str] = None) -> Dict:
        uid = user_id or self.user_id
        if not uid:
            return {}
        
        custom_path = self.get_custom_poses_path(uid)
        if os.path.exists(custom_path):
            try:
                with open(custom_path, 'r') as f:
                    data = json.load(f)
                    self.custom_poses = data
                    logger.info(f"Loaded {len(data)} custom poses for user {uid[:8]}")
                    return data
            except Exception as e:
                logger.error(f"Error loading custom poses: {e}")
        
        self.custom_poses = {}
        return {}
    
    def save_custom_poses(self, user_id: Optional[str] = None) -> bool:
        uid = user_id or self.user_id
        if not uid:
            return False
        
        custom_path = self.get_custom_poses_path(uid)
        try:
            os.makedirs(os.path.dirname(custom_path), exist_ok=True)
            with open(custom_path, 'w') as f:
                json.dump(self.custom_poses, f, indent=2)
            logger.info(f"Saved {len(self.custom_poses)} custom poses for user {uid[:8]}")
            return True
        except Exception as e:
            logger.error(f"Error saving custom poses: {e}")
            return False
    
    def add_custom_pose(
        self,
        pose_id: str,
        reference: Dict,
        images: List[str],
        user_id: Optional[str] = None
    ) -> bool:
        uid = user_id or self.user_id
        if not uid:
            return False
        
        logger.info(f"📂 Adding custom pose {pose_id} for user {uid[:8]}")
        self.load_custom_poses(uid)
        
        if pose_id in self.custom_poses:
            logger.warning(f"⚠️ Pose {pose_id} already exists, overwriting")
        
        self.custom_poses[pose_id] = reference
        logger.info(f"📝 Reference data for {pose_id}: angles={len(reference.get('angles', []))} joints")
        
        if images:
            upload_dir = self.get_upload_dir(pose_id, uid)
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
        
        return self.save_custom_poses(uid)
    
    def get_custom_pose(self, pose_id: str, user_id: Optional[str] = None) -> Optional[Dict]:
        uid = user_id or self.user_id
        if not uid:
            return None
        
        self.load_custom_poses(uid)
        return self.custom_poses.get(pose_id)
    
    def get_all_custom_poses(self, user_id: Optional[str] = None) -> Dict:
        uid = user_id or self.user_id
        if not uid:
            return {}
        
        self.load_custom_poses(uid)
        return self.custom_poses
    
    def delete_custom_pose(self, pose_id: str, user_id: Optional[str] = None) -> bool:
        uid = user_id or self.user_id
        if not uid:
            return False
        
        self.load_custom_poses(uid)
        if pose_id not in self.custom_poses:
            return False
        
        del self.custom_poses[pose_id]
        
        upload_dir = self.get_upload_dir(pose_id, uid)
        if os.path.exists(upload_dir):
            shutil.rmtree(upload_dir)
        
        return self.save_custom_poses(uid)
    
    def get_pose_image_paths(self, pose_id: str, user_id: Optional[str] = None) -> List[str]:
        uid = user_id or self.user_id
        if not uid:
            return []
        
        upload_dir = self.get_upload_dir(pose_id, uid)
        if not os.path.exists(upload_dir):
            return []
        
        images = []
        for f in sorted(os.listdir(upload_dir)):
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                images.append(os.path.join(upload_dir, f))
        return images
    
    def merge_with_builtin(self, builtin_poses: Dict) -> Dict:
        merged = builtin_poses.copy()
        for pose_id, data in self.custom_poses.items():
            if pose_id not in merged:
                merged[pose_id] = data
        return merged
    
    def get_pose_list(self, builtin_poses: Dict) -> List[Dict]:
        merged = self.merge_with_builtin(builtin_poses)
        result = []
        for pose_id, data in merged.items():
            is_custom = pose_id in self.custom_poses
            result.append({
                'id': pose_id,
                'name': data.get('name', pose_id),
                'english': data.get('name', pose_id),
                'difficulty': data.get('difficulty', 'Beginner'),
                'category': data.get('category', 'General'),
                'sample_count': data.get('sample_count', 0),
                'is_custom': is_custom,
                'generated_at': data.get('generated_at', None),
                'similarity_score': data.get('similarity_score', None),
            })
        return sorted(result, key=lambda x: x['name'])
        