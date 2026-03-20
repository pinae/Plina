import os

# --- Configuration ---

# 1. Define the introductory markdown text
intro_text = ""
with open("README.md", "r", encoding="utf-8") as f:
    intro_text += f.read()

# 2. List of files and folders to explicitly skip in the file tree and content output
exclude_patterns = {'.git', '__pycache__', 'node_modules', '.venv', '.turbo',
                    'apps/backend/.turbo', 'apps/backend/.venv', 'apps/backend/htmlcov',
                    'apps/backend/initial-data', 'apps/backend/media', 'apps/backend/db.sqlite3',
                    'apps/backend/run_e2e_backend.sh', 'apps/backend/test_e2e_db.sqlite3', 'apps/backend/uv.lock',
                    'project_overview_generator.py', '.idea',
                    'apps/frontend/.storybook', 'apps/frontend/.turbo', 'apps/frontend/coverage',
                    'apps/frontend/dist', 'apps/frontend/node_modules', 'apps/frontend/playwright-report',
                    'apps/frontend/test-results', 'apps/frontend/debug-storybook.log',
                    'README.md', 'desc.txt'}

# 3. Define the file extensions to include in the output
#    Files with these extensions will have their content printed.
allowed_extensions = {
    '.js', '.jsx', '.py', '.c', '.h', '.html', '.css', '.j2',
    '.txt', '.md', '.rst', '.json', '.yml', '.yaml'
}

# 4. Define the root directory of the project to analyze
#    An empty string '' means the current directory where the script is run.
root_dir = ''


# --- Script Logic ---

def get_file_tree(start_path, exclude):
    """Generates a string representation of the directory tree."""
    tree_lines = []
    for root, dirs, files in os.walk(start_path, topdown=True):

        # --- Filter directories by base name OR relative path ---
        for d in list(dirs):
            dir_path = os.path.join(root, d)
            rel_dir = os.path.relpath(dir_path, start_path).replace(os.sep, '/')
            if d in exclude or rel_dir in exclude:
                dirs.remove(d)  # Removes it from os.walk traversal

        level = root.replace(start_path, '').count(os.sep)
        indent = ' ' * 4 * level

        # Add the current directory to the tree, skip for root
        if level > 0 or (start_path == '' and os.path.basename(root)):
            tree_lines.append(f"{indent}|-- {os.path.basename(root)}/")

        sub_indent = ' ' * 4 * (level + 1)

        # --- Filter files by base name OR relative path ---
        for f in sorted(files):
            file_path = os.path.join(root, f)
            rel_file = os.path.relpath(file_path, start_path).replace(os.sep, '/')
            if f not in exclude and rel_file not in exclude:
                tree_lines.append(f"{sub_indent}|-- {f}")

    return "\n".join(tree_lines)


def get_file_content(filepath):
    """Reads and returns the content of a file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file '{filepath}': {e}"


def get_language_from_extension(filename):
    """Determines the language for markdown code block from file extension."""
    extension_map = {
        '.js': 'javascript',
        '.py': 'python',
        '.c': 'c',
        '.h': 'c',
        '.html': 'html',
        '.css': 'css',
        '.j2': 'jinja',
        '.txt': 'text',
        '.md': 'markdown',
        '.rst': 'rst',
        '.json': 'json',
        '.yml': 'yaml',
        '.yaml': 'yaml'
    }
    _, ext = os.path.splitext(filename)
    return extension_map.get(ext.lower(), '')


def main():
    """Main function to generate and print the project overview."""

    # Start with the introductory text
    markdown_output = [intro_text]

    # --- File Tree ---
    markdown_output.append("## Directory and File Structure")
    markdown_output.append("```")

    project_root = root_dir if root_dir else os.getcwd()
    file_tree = get_file_tree(project_root, exclude_patterns)
    markdown_output.append(file_tree)

    markdown_output.append("```")

    # --- File Contents ---
    markdown_output.append("\n## Source Code Files")

    for root, dirs, files in os.walk(project_root, topdown=True):

        # --- Filter directories by base name OR relative path ---
        for d in list(dirs):
            dir_path = os.path.join(root, d)
            rel_dir = os.path.relpath(dir_path, project_root).replace(os.sep, '/')
            if d in exclude_patterns or rel_dir in exclude_patterns:
                dirs.remove(d)

        for filename in sorted(files):
            file_path = os.path.join(root, filename)
            relative_path = os.path.relpath(file_path, project_root).replace(os.sep, '/')

            # --- Check if the file itself should be excluded (base or relative) ---
            if filename in exclude_patterns or relative_path in exclude_patterns:
                continue

            _, ext = os.path.splitext(filename)
            if ext.lower() in allowed_extensions:
                content = get_file_content(file_path)
                lang = get_language_from_extension(filename)

                markdown_output.append(f"\nBelow is the content of the file `{relative_path}`:")
                markdown_output.append(f"```{lang}\n{content}\n```")

    # Save the final markdown document to desc.txt
    with open("desc.txt", 'w', encoding='utf-8') as f:
        f.write("\n".join(markdown_output))


if __name__ == "__main__":
    main()