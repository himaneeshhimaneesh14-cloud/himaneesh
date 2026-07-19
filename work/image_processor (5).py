"""
Image Processor Module
Handles image upload, validation, and storage
"""

import os
import logging
import shutil
import uuid
from typing import Optional, Dict, List, Tuple
from PIL import Image
import cv2
import numpy as np

logger = logging.getLogger(__name__)

class ImageProcessor:
    """Handle image processing, validation, and storage."""
    
    ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}
    MAX_FILE_SIZE = 10 * 1024 * 1024  
    REQUIRED_IMAGES = 5
    
    def __init__(self, upload_dir: str = "temp_uploads"):
        self.upload_dir = upload_dir
        os.makedirs(upload_dir, exist_ok=True)
    
    def validate_image(self, file_path: str) -> Tuple[bool, str]:
        if not os.path.exists(file_path):
            return False, "File does not exist"
        
        size = os.path.getsize(file_path)
        if size > self.MAX_FILE_SIZE:
            return False, f"File too large. Maximum size: {self.MAX_FILE_SIZE // (1024*1024)} MB"
        
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in self.ALLOWED_EXTENSIONS:
            return False, f"Unsupported file format: {ext}"
        
        try:
            img = Image.open(file_path)
            img.verify()
            img = Image.open(file_path)
            if img.size[0] < 50 or img.size[1] < 50:
                return False, "Image too small. Minimum size: 50x50 pixels"
            return True, ""
        except Exception as e:
            return False, f"Invalid image: {str(e)}"
    
    def save_temp_image(self, file_data: bytes, original_filename: str) -> Optional[str]:
        logger.info(f"📥 Saving temp image: {original_filename}")
        try:
            ext = os.path.splitext(original_filename)[1].lower()
            if ext not in self.ALLOWED_EXTENSIONS:
                ext = '.jpg'
                logger.info(f"📄 Extension changed to {ext}")
            
            filename = f"{uuid.uuid4()}{ext}"
            file_path = os.path.join(self.upload_dir, filename)
            
            with open(file_path, 'wb') as f:
                f.write(file_data)
            logger.info(f"💾 File written to {file_path} ({len(file_data)} bytes)")
            
            valid, error = self.validate_image(file_path)
            if not valid:
                os.remove(file_path)
                logger.error(f"❌ Image validation failed: {error}")
                return None
            
            logger.info(f"✅ Image validation passed")
            return file_path
            
        except Exception as e:
            logger.error(f"❌ Error saving temp image: {e}")
            return None
    
    def save_temp_image_from_base64(self, b64_data: str, filename: str = "image.jpg") -> Optional[str]:
        import base64
        try:
            if ',' in b64_data:
                b64_data = b64_data.split(',', 1)[1]
            file_data = base64.b64decode(b64_data)
            return self.save_temp_image(file_data, filename)
        except Exception as e:
            logger.error(f"Error saving image from base64: {e}")
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
    
    def cleanup_temp_dir(self, max_age_seconds: int = 3600):
        import time
        now = time.time()
        for f in os.listdir(self.upload_dir):
            file_path = os.path.join(self.upload_dir, f)
            if os.path.isfile(file_path):
                mtime = os.path.getmtime(file_path)
                if now - mtime > max_age_seconds:
                    try:
                        os.remove(file_path)
                        logger.info(f"🧹 Cleaned up old temp file: {f}")
                    except:
                        pass
    
    def batch_validate_images(self, file_paths: List[str]) -> List[Tuple[str, str]]:
        errors = []
        for path in file_paths:
            valid, error = self.validate_image(path)
            if not valid:
                errors.append((path, error))
        return errors
    
    def process_reference_images(
        self,
        image_data_list: List[bytes],
        filenames: List[str]
    ) -> List[Optional[str]]:
        if len(image_data_list) != self.REQUIRED_IMAGES:
            raise ValueError(f"Expected {self.REQUIRED_IMAGES} images")
        
        saved_paths = []
        for data, filename in zip(image_data_list, filenames):
            path = self.save_temp_image(data, filename)
            saved_paths.append(path)
        
        return saved_paths
    
    def resize_image(self, file_path: str, max_size: Tuple[int, int] = (1024, 1024)) -> str:
        try:
            img = Image.open(file_path)
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            img.save(file_path, quality=85, optimize=True)
            return file_path
        except Exception as e:
            logger.error(f"Error resizing image: {e}")
            return file_path
    
    def extract_image_metadata(self, file_path: str) -> Optional[Dict]:
        try:
            img = Image.open(file_path)
            return {
                'width': img.size[0],
                'height': img.size[1],
                'format': img.format,
                'mode': img.mode,
                'size_bytes': os.path.getsize(file_path),
                'filename': os.path.basename(file_path),
            }
        except Exception as e:
            logger.error(f"Error extracting metadata: {e}")
            return None

    def get_image_base64(self, file_path: str) -> Optional[str]:
        import base64
        try:
            with open(file_path, 'rb') as f:
                data = f.read()
                return base64.b64encode(data).decode('utf-8')
        except Exception as e:
            logger.error(f"Error encoding image to base64: {e}")
            return None
            