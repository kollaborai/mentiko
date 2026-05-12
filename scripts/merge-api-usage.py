#!/usr/bin/env python3
"""
Merge API usage data into API_INDEX.md
Adds 'Used?' and 'Screen/Component' columns to all tables
"""

import re
from pathlib import Path

# Resolve files relative to this checkout, not a developer-specific path
REPO_ROOT = Path(__file__).resolve().parents[1]

# Read the usage data into a dict
usage_data = {}
current_section = None

usage_file = REPO_ROOT / "docs" / "API_USAGE.md"
for line in usage_file.read_text().split('\n'):
    if line.startswith('## '):
        current_section = line[3:].strip()
        if current_section:
            usage_data[current_section] = {}
    elif current_section and line.startswith('| GET') or line.startswith('| POST') or line.startswith('| PUT') or line.startswith('| PATCH') or line.startswith('| DELETE'):
        if 'Method' not in line and '---' not in line:
            # Parse the usage table row
            parts = line.split('|')
            if len(parts) >= 4:
                path = parts[2].strip()
                if path.startswith('`'):
                    clean_path = path.strip('`*')
                    used = parts[3].strip()
                    component = parts[4].strip() if len(parts) > 4 else ''
                    # Remove markdown formatting
                    used_clean = used.strip('*').strip()
                    component_clean = component.strip('`*').strip()
                    usage_data[current_section][clean_path] = (used_clean, component_clean)

# Now read and update API_INDEX.md
api_index_file = REPO_ROOT / "docs" / "API_INDEX.md"
content = api_index_file.read_text()
lines = content.split('\n')

output_lines = []
current_table_section = None
in_table = False
header_found = False

for i, line in enumerate(lines):
    # Detect section headers
    if line.startswith('## '):
        current_table_section = line[3:].strip()
        in_table = False
        header_found = False
        output_lines.append(line)
    # Detect table header with Method | Path
    elif '| Method | Path |' in line:
        in_table = True
        header_found = True
        # Add new columns to header
        if 'Used?' not in line:
            output_lines.append(line.rstrip() + ' | Used? | Screen/Component |')
        else:
            output_lines.append(line)
    # Detect separator row
    elif in_table and line.startswith('|---'):
        output_lines.append(line.rstrip() + ' |-------|------------------|')
        header_found = False
    # Table data rows
    elif in_table and not line.startswith('|---') and line.startswith('|'):
        parts = line.split('|')
        if len(parts) >= 6:
            # Extract the path
            path_col = parts[2].strip()
            if path_col.startswith('`') and path_col.endswith('`'):
                path = path_col.strip('`*')
                # Look up usage data
                section_key = None
                for key in usage_data:
                    if path in usage_data[key]:
                        section_key = key
                        break

                used = 'No'
                component = '-'
                if section_key and path in usage_data[section_key]:
                    used, component = usage_data[section_key][path]
                    # Abbreviate component names
                    component = component
                    # Common abbreviations
                    component = re.sub(r'web/(app|components|hooks|lib)/', '', component)
                    component = component.replace('page.tsx', 'page')
                    component = component.replace('tsx', '')
                    component = component.replace('.ts', '')
                    component = component.replace('//', '/')
                    component = component.replace('(workflows)/', '')
                    # Shorten further
                    component = component.replace('components/', '')
                    component = component.replace('hooks/', '')
                    component = component.replace('lib/', '')
                    # Truncate if too long
                    if len(component) > 60:
                        component = component[:57] + '...'

                # Add new columns
                output_lines.append(line.rstrip() + f' | {used} | {component} |')
            else:
                output_lines.append(line)
        else:
            output_lines.append(line)
    else:
        output_lines.append(line)

# Write updated file
api_index_file.write_text('\n'.join(output_lines))
print("Updated API_INDEX.md with usage columns")
